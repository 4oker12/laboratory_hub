
import SwiftUI
import CoreMotion
import CoreLocation
import Foundation


// Core Location supplies DEVICE orientation, not true walking direction.
// GPS is diagnostic only and NEVER silently modifies the indoor map.
final class IndoorSensorBridge: NSObject, CLLocationManagerDelegate {
    var onHeading: ((Double, Double) -> Void)?
    var onGPS: ((CLLocation) -> Void)?
    var onError: ((String) -> Void)?
    private let manager = CLLocationManager()

    func begin() {
        manager.delegate = self
        manager.headingFilter = 5
        manager.distanceFilter = 2
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.requestWhenInUseAuthorization()
        if CLLocationManager.headingAvailable() {
            manager.startUpdatingHeading()
        } else {
            onError?("COMPASS_UNAVAILABLE")
        }
        manager.startUpdatingLocation()
    }
    func end() {
        manager.stopUpdatingHeading()
        manager.stopUpdatingLocation()
    }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading h: CLHeading) {
        onHeading?(h.magneticHeading, h.headingAccuracy)
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations ls: [CLLocation]) {
        if let l = ls.last { onGPS?(l) }
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError e: Error) {
        onError?("CORE_LOCATION_ERROR " + e.localizedDescription)
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            onError?("LOCATION_PERMISSION_DENIED (GPS optional; manual fallback)")
        }
    }
}

@main
struct NetCheckWalkTestApp: App {
    var body: some Scene { WindowGroup { WalkScreen() } }
}

struct WalkSample: Identifiable {
    let id = UUID()
    let date: Date
    let position: CGPoint
    let milliseconds: Double?
    let status: String
}

@MainActor
final class WalkModel: ObservableObject {
    enum Step { case router, phone, ready, recording, finished }
    @Published var step: Step = .router
    @Published var router = CGPoint(x: 0.5, y: 0.5)
    @Published var phone = CGPoint(x: 0.66, y: 0.56)
    @Published var trail: [CGPoint] = []
    @Published var points: [WalkSample] = []
    @Published var meters: Double = 0
    @Published var steps: Int = 0
    @Published var headingDegrees: Double = 0 // manual direction; 0 = map up
    @Published var compassDegrees: Double?
    @Published var compassAccuracyDeg: Double?
    @Published var gpsAccuracyM: Double?
    @Published var gpsDeltaM: Double?
    @Published var compassAligned = false
    @Published var correctingPosition = false
    @Published var directionSource = "Ручное ↑"
    var distanceFromRouterM: Double {
        hypot((phone.x - router.x) * mapMeters, (phone.y - router.y) * mapMeters)
    }
    @Published var status = "Укажите положение роутера"
    @Published var logging: [String] = []
    @Published var testing = false

    private let pedometer = CMPedometer()
    private let sensors = IndoorSensorBridge()
    private var compassReferenceDeg: Double?
    private var gpsOrigin: CLLocation?
    private var lastHeadingLogAt = Date.distantPast
    private var lastGPSLogAt = Date.distantPast
    private var lastBoundaryLogAt = Date.distantPast
    private var timer: Timer?
    private var lastMotionAt = Date()
    private var lastRecordedDistance: Double = 0
    private var lastPaintedDistance: Double = 0
    private var didReachThreshold = false
    private var lastSampleAt = Date()
    private let mapMeters: Double = 16
    let logURL: URL

    init() {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        logURL = dir.appendingPathComponent("NetCheck-WalkTest-logs.txt")
        if let previous = try? String(contentsOf: logURL, encoding: .utf8) {
            logging = Array(previous.components(separatedBy: .newlines).filter { !$0.isEmpty }.suffix(100))
        }
        log("APP_LAUNCH", "Запуск приложения, v0.4 PDR experimental")
    }

    func log(_ tag: String, _ message: String) {
        let time = ISO8601DateFormatter().string(from: Date())
        let entry = "[\(time)] \(tag): \(message)"
        logging.append(entry)
        if logging.count > 300 { logging.removeFirst(logging.count - 300) }
        let value = (entry + "\n").data(using: .utf8) ?? Data()
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        if let file = try? FileHandle(forWritingTo: logURL) {
            defer { try? file.close() }
            _ = try? file.seekToEnd()
            try? file.write(contentsOf: value)
        }
    }

    func place(_ coordinate: CGPoint) {
        let p = CGPoint(x: min(max(coordinate.x, 0.03), 0.97),
                        y: min(max(coordinate.y, 0.03), 0.97))
        if correctingPosition && step == .recording {
            phone = p
            trail.append(p)
            correctingPosition = false
            log("POSITION_CORRECTED", "x=\(p.x) y=\(p.y)")
            status = "Положение исправлено вручную"
            return
        }
        if step == .router {
            router = p
            step = .phone
            status = "Теперь укажите своё положение"
            log("ROUTER_SET", "x=\(p.x) y=\(p.y)")
        } else if step == .phone || step == .ready {
            phone = p
            trail = [p]
            step = .ready
            status = "Маршрут готов к обследованию"
            log("PHONE_START_SET", "x=\(p.x) y=\(p.y)")
        }
    }

    func setRouterAtCenter() {
        router = CGPoint(x: 0.5, y: 0.5)
        step = .phone
        status = "Коснитесь своего места на плане"
        log("ROUTER_SET", "center")
    }

    func start() {
        guard step == .ready || step == .finished else { return }
        if !CMPedometer.isStepCountingAvailable() {
            status = "Шагомер недоступен — используйте ручной замер"
            log("PEDOMETER_UNAVAILABLE", "step counting not available")
        }
        step = .recording
        meters = 0
        steps = 0
        lastRecordedDistance = 0
        lastPaintedDistance = 0
        didReachThreshold = false
        lastMotionAt = Date()
        lastSampleAt = Date()
        trail = [phone]
        points.removeAll()
        log("SURVEY_STARTED", "trigger=3m+5s, map=16m, PDR requires calibration")
        status = "Обход начат. Держите верх телефона по направлению ходьбы"
        gpsOrigin = nil
        gpsDeltaM = nil
        compassReferenceDeg = nil
        compassAligned = false
        compassDegrees = nil
        compassAccuracyDeg = nil
        gpsAccuracyM = nil
        directionSource = "Ручное ↑"
        correctingPosition = false
        sensors.onHeading = { [weak self] degrees, accuracy in
            Task { @MainActor [weak self] in self?.handleHeading(degrees, accuracy: accuracy) }
        }
        sensors.onGPS = { [weak self] location in
            Task { @MainActor [weak self] in self?.handleGPS(location) }
        }
        sensors.onError = { [weak self] reason in
            Task { @MainActor [weak self] in self?.log("SENSOR_ERROR", reason) }
        }
        sensors.begin()
        if CMPedometer.isStepCountingAvailable() {
            pedometer.startUpdates(from: Date()) { [weak self] data, error in
                Task { @MainActor [weak self] in
                    guard let self = self, self.step == .recording else { return }
                    if let error = error {
                        self.log("MOTION_ERROR", error.localizedDescription)
                        return
                    }
                    if let data = data {
                        self.accept(steps: data.numberOfSteps.intValue,
                                    distance: data.distance?.doubleValue)
                    }
                }
            }
        }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        Task { await measure(reason: "baseline") }
    }

    private func accept(steps newSteps: Int, distance: Double?) {
        let newDistance = max(meters, distance ?? Double(newSteps) * 0.7)
        if newSteps != steps || newDistance > meters + 0.06 { lastMotionAt = Date() }
        steps = newSteps
        meters = newDistance

        let delta = newDistance - lastPaintedDistance
        if delta > 0.10 {
            // PDR = step distance + device-facing direction (not measured walking course).
            let direction: Double
            if compassAligned, let h = compassDegrees,
               let acc = compassAccuracyDeg, acc >= 0, acc <= 25,
               let base = compassReferenceDeg {
                direction = (h - base + 360).truncatingRemainder(dividingBy: 360)
                directionSource = "Компас (оценка)"
            } else {
                direction = headingDegrees
                directionSource = "Ручное (оценка)"
            }
            let rad = direction * .pi / 180
            // Screen coordinate axes: 0° UP, 90° RIGHT.
            let wantedX = phone.x + sin(rad) * delta / mapMeters
            let wantedY = phone.y - cos(rad) * delta / mapMeters
            let newX = min(max(wantedX, 0.03), 0.97)
            let newY = min(max(wantedY, 0.03), 0.97)
            if (newX != wantedX || newY != wantedY) &&
               Date().timeIntervalSince(lastBoundaryLogAt) > 8 {
                lastBoundaryLogAt = Date()
                log("MAP_BOUNDARY", "Оценочный след вышел за пределы карты")
            }
            phone = CGPoint(x: newX, y: newY)
            trail.append(phone)
            lastPaintedDistance = newDistance
            log("TRACK_SEGMENT",
                "deltaM=\(String(format: "%.2f", delta)); angle=\(String(format: "%.1f", direction)); mode=\(directionSource); x=\(String(format: "%.3f", newX)); y=\(String(format: "%.3f", newY)); routerDistanceM=~\(String(format: "%.2f", distanceFromRouterM))")
        }
        if meters - lastRecordedDistance >= 3 && !didReachThreshold {
            didReachThreshold = true
            log("DISTANCE_THRESHOLD", "meters=\(String(format: "%.2f", meters))")
            status = "Пройдено 3 м. Остановитесь на 5 секунд"
        }
    }

    private func handleHeading(_ heading: Double, accuracy: Double) {
        guard step == .recording else { return }
        if !heading.isFinite || accuracy < 0 {
            compassAccuracyDeg = nil
            if Date().timeIntervalSince(lastHeadingLogAt) > 12 {
                lastHeadingLogAt = Date()
                log("HEADING_INVALID", "Компас не откалиброван или помехи")
            }
            return
        }
        compassDegrees = heading
        compassAccuracyDeg = accuracy
        if Date().timeIntervalSince(lastHeadingLogAt) > 10 {
            lastHeadingLogAt = Date()
            log("HEADING_READING", "magnetic=\(String(format: "%.0f", heading))°; accuracy=±\(String(format: "%.0f", accuracy))°")
        }
    }

    private func handleGPS(_ location: CLLocation) {
        guard step == .recording else { return }
        let accuracy = location.horizontalAccuracy
        guard accuracy >= 0 && location.timestamp.timeIntervalSinceNow > -15 else { return }
        gpsAccuracyM = accuracy
        // GPS does NOT drive the indoor trace, even when accuracy seems good.
        if accuracy <= 5 {
            if gpsOrigin == nil {
                gpsOrigin = location
                log("GPS_REFERENCE", "accuracyM=\(String(format: "%.1f", accuracy)); no coordinates recorded")
            }
            if let origin = gpsOrigin { gpsDeltaM = location.distance(from: origin) }
        } else {
            gpsDeltaM = nil
        }
        if Date().timeIntervalSince(lastGPSLogAt) > 15 {
            lastGPSLogAt = Date()
            log("GPS_QUALITY", "accuracyM=\(String(format: "%.1f", accuracy)); not used to move marker")
        }
    }

    func alignCompass() {
        guard step == .recording else { return }
        guard let heading = compassDegrees,
              let accuracy = compassAccuracyDeg, accuracy >= 0 && accuracy <= 25 else {
            log("COMPASS_ALIGN_FAILED", "No heading or accuracy greater than 25 degrees")
            status = "Компас неточен. Пользуйтесь ручными стрелками"
            return
        }
        compassReferenceDeg = heading
        compassAligned = true
        directionSource = "Компас (оценка)"
        log("COMPASS_ALIGNED", "reference=\(String(format: "%.0f", heading))°; phone top toward MAP UP")
        status = "Компас совмещён. Держите верх экрана по ходу движения"
    }

    func toggleCorrection() {
        guard step == .recording else { return }
        correctingPosition.toggle()
        log("POSITION_CORRECTION_MODE", correctingPosition ? "tap map to correct" : "disabled")
    }

    private func tick() {
        guard step == .recording, !testing else { return }
        if didReachThreshold && Date().timeIntervalSince(lastMotionAt) >= 5 {
            didReachThreshold = false
            lastRecordedDistance = meters
            log("STOP_DETECTED", "5 sec; distance=\(String(format:"%.2f", meters))")
            Task { await measure(reason: "movement_stop") }
        } else if Date().timeIntervalSince(lastSampleAt) >= 30 * 60 {
            lastSampleAt = Date()
            Task { await measure(reason: "periodic_30m") }
        }
    }

    func turn(_ degrees: Double) {
        headingDegrees = (headingDegrees + degrees + 360).truncatingRemainder(dividingBy: 360)
        compassAligned = false
        directionSource = "Ручное (оценка)"
        log("HEADING_MANUAL", "mapDirection=\(headingDegrees); compass disabled")
    }

    func manualMeasurement() {
        guard step == .recording || step == .finished else { return }
        Task { await measure(reason: "manual") }
    }

    func measure(reason: String) async {
        guard !testing else { return }
        testing = true
        let point = phone
        log("PROBE_STARTED", "\(reason); x=\(String(format: "%.3f", point.x)); y=\(String(format: "%.3f", point.y)); routerDistanceM=~\(String(format: "%.2f", distanceFromRouterM)); source=\(directionSource)")
        var result: Double?
        var text = "Ошибка сети"
        do {
            var request = URLRequest(url: URL(string: "https://www.cloudflare.com/cdn-cgi/trace")!)
            request.timeoutInterval = 10
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let began = Date()
            let (_, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, (200...399).contains(http.statusCode) {
                result = Date().timeIntervalSince(began) * 1000
                text = "HTTP \(http.statusCode)"
                log("PROBE_OK", "\(reason), httpRTT=\(Int(result ?? 0))ms")
            } else {
                text = "HTTP-ошибка"
                log("PROBE_HTTP_ERROR", "\(reason)")
            }
        } catch {
            text = error.localizedDescription
            log("PROBE_ERROR", "\(reason): \(error.localizedDescription)")
        }
        points.append(WalkSample(date: Date(), position: point, milliseconds: result, status: text))
        log("POINT_SAVED", "count=\(points.count), \(text)")
        status = result == nil ? "Точка \(points.count): ошибка проверки" :
            "Точка \(points.count): HTTP \(Int(result ?? 0)) мс"
        lastSampleAt = Date()
        testing = false
    }

    func finish() {
        sensors.end()
        pedometer.stopUpdates()
        timer?.invalidate()
        timer = nil
        step = .finished
        status = "Обследование завершено. Точек: \(points.count)"
        log("SURVEY_FINISHED", "steps=\(steps), meters=\(meters), points=\(points.count)")
    }

    func restart() {
        sensors.end()
        pedometer.stopUpdates()
        timer?.invalidate()
        timer = nil
        step = .router
        trail.removeAll()
        points.removeAll()
        status = "Укажите положение роутера"
        compassAligned = false
        correctingPosition = false
        compassReferenceDeg = nil
        log("SURVEY_RESET", "new map")
    }
}

struct WalkScreen: View {
    @StateObject private var model = WalkModel()
    @State private var showLogs = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Image(systemName: "wifi.router.fill")
                            .foregroundStyle(.blue)
                        Text("NetCheck Explorer").font(.title2.bold())
                    }
                    Text(model.status)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    VStack(spacing: 0) {
                        GeometryReader { proxy in
                            ZStack {
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color(red: 0.95, green: 0.96, blue: 0.94))
                                Path { path in
                                    let w = proxy.size.width, h = proxy.size.height
                                    path.move(to: CGPoint(x: w * 0.42, y: 0))
                                    path.addLine(to: CGPoint(x: w * 0.42, y: h * 0.39))
                                    path.move(to: CGPoint(x: w * 0.42, y: h * 0.53))
                                    path.addLine(to: CGPoint(x: w * 0.42, y: h))
                                    path.move(to: CGPoint(x: w * 0.42, y: h * 0.56))
                                    path.addLine(to: CGPoint(x: w, y: h * 0.56))
                                }
                                .stroke(Color.gray.opacity(0.45), style: StrokeStyle(lineWidth: 3))
                                Path { path in
                                    guard let first = model.trail.first else { return }
                                    path.move(to: CGPoint(x: first.x * proxy.size.width,
                                                          y: first.y * proxy.size.height))
                                    for p in model.trail.dropFirst() {
                                        path.addLine(to: CGPoint(x: p.x * proxy.size.width,
                                                                 y: p.y * proxy.size.height))
                                    }
                                }
                                .stroke(.teal, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round, dash: [4, 4]))
                                ForEach(Array(model.points.enumerated()), id: \.element.id) { idx, sample in
                                    Circle().fill(sample.milliseconds == nil ? .red : .green)
                                        .frame(width: 13, height: 13)
                                        .position(x: sample.position.x * proxy.size.width,
                                                  y: sample.position.y * proxy.size.height)
                                }
                                Image(systemName: "wifi.router.fill")
                                    .font(.title3)
                                    .foregroundStyle(.blue)
                                    .padding(9)
                                    .background(.white, in: Circle())
                                    .position(x: model.router.x * proxy.size.width,
                                              y: model.router.y * proxy.size.height)
                                Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                                    .font(.title3)
                                    .foregroundStyle(.white)
                                    .padding(9)
                                    .background(.teal, in: Circle())
                                    .position(x: model.phone.x * proxy.size.width,
                                              y: model.phone.y * proxy.size.height)
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .contentShape(Rectangle())
                            .gesture(SpatialTapGesture().onEnded { value in
                                model.place(CGPoint(x: value.location.x / max(proxy.size.width, 1),
                                                    y: value.location.y / max(proxy.size.height, 1)))
                            })
                        }
                        .frame(height: 300)
                    }
                    Text("План условный; стены и положение телефона задаются вручную. След по шагам приблизительный.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        if model.step == .router {
                            Button("Роутер в центре") { model.setRouterAtCenter() }
                                .buttonStyle(.borderedProminent)
                        } else if model.step == .phone {
                            Text("Нажмите на карту, чтобы поставить телефон")
                                .font(.subheadline)
                        } else if model.step == .ready || model.step == .finished {
                            Button("Начать обход") { model.start() }
                                .buttonStyle(.borderedProminent)
                        } else {
                            Button("Замер сейчас") { model.manualMeasurement() }
                                .buttonStyle(.bordered)
                            Button("Завершить") { model.finish() }
                                .buttonStyle(.borderedProminent)
                        }
                        Spacer(minLength: 0)
                        Button("Сбросить") { model.restart() }
                            .buttonStyle(.bordered)
                    }
                    HStack {
                        metric("Шагов", "\(model.steps)")
                        metric("Пройдено", String(format: "%.1f м", model.meters))
                        metric("Точек", "\(model.points.count)")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "location.north.line.fill").foregroundStyle(.teal)
                            Text("До роутера: ~\(String(format: "%.1f", model.distanceFromRouterM)) м")
                                .font(.headline.monospacedDigit())
                        }
                        Text("Расстояние вычислено по приблизительному следу, а не измерено GPS или Wi-Fi.")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 10) {
                            Text("Компас: \(model.compassDegrees.map { String(format: "%.0f°", $0) } ?? "нет")")
                            Text("±\(model.compassAccuracyDeg.map { String(format: "%.0f°", $0) } ?? "?")")
                            Spacer()
                            Text("GPS ±\(model.gpsAccuracyM.map { String(format: "%.0f м", $0) } ?? "?")")
                        }
                        .font(.caption.monospacedDigit())
                        Text("Направление: \(model.directionSource)")
                            .font(.caption).foregroundStyle(.secondary)
                        HStack(spacing: 8) {
                            Button("Совместить компас ↑") { model.alignCompass() }
                                .buttonStyle(.borderedProminent)
                                .disabled(model.step != .recording)
                            Button("↶") { model.turn(-90) }.buttonStyle(.bordered)
                            Button("↷") { model.turn(90) }.buttonStyle(.bordered)
                            Spacer(minLength: 0)
                        }
                        Button(model.correctingPosition ? "Нажмите на правильное место" : "Исправить моё положение") {
                            model.toggleCorrection()
                        }
                        .buttonStyle(.bordered)
                        .disabled(model.step != .recording)
                        Text("Для совмещения направьте ВЕРХ телефона к ВЕРХУ карты. Во время ходьбы направляйте верх телефона по ходу движения.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    .padding(12)
                    .background(.teal.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
                    Text("Замер: после 3 м и 5 секунд без новых шагов. GPS только для контроля точности. След приблизительный.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Журнал ошибок и событий") { showLogs = true }
                        .buttonStyle(.bordered)
                }
                .padding()
            }
            .navigationBarTitleDisplayMode(.inline)
            .sheet(isPresented: $showLogs) {
                NavigationStack {
                    ScrollView {
                        Text(model.logging.joined(separator: "\n"))
                            .font(.system(size: 11, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .textSelection(.enabled)
                            .padding()
                    }
                    .navigationTitle("Логи")
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button("Закрыть") { showLogs = false }
                        }
                        ToolbarItem(placement: .topBarTrailing) {
                            ShareLink(item: model.logURL) { Image(systemName: "square.and.arrow.up") }
                        }
                    }
                }
            }
        }
    }

    private func metric(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.headline.monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.gray.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}
