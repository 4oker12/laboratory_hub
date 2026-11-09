
import SwiftUI
import CoreMotion
import CoreLocation
import Foundation


// Heading is the orientation of the TOP of the phone, not measured walking direction.
// It only becomes a walking direction when the user holds the phone facing forward.
final class NetCheckHeadingReader: NSObject, CLLocationManagerDelegate {
    var onHeading: ((Double, Double) -> Void)?
    var onFailure: ((String) -> Void)?
    private let manager = CLLocationManager()

    func begin() {
        manager.delegate = self
        manager.headingFilter = 3.0
        if !CLLocationManager.headingAvailable() {
            onFailure?("HEADING_UNAVAILABLE")
            return
        }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
        manager.startUpdatingHeading()
    }

    func end() {
        manager.stopUpdatingHeading()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading heading: CLHeading) {
        onHeading?(heading.magneticHeading, heading.headingAccuracy)
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            onFailure?("LOCATION_PERMISSION_DENIED; manual direction remains available")
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        onFailure?("CORE_LOCATION_ERROR: " + error.localizedDescription)
    }
}

@main
struct NetCheckWalkTestApp: App {
    @StateObject private var probe = WiFiProbeStore()
    var body: some Scene {
        WindowGroup {
            TabView {
                WalkScreen(probe:probe)
                    .tabItem { Label("Обход", systemImage: "figure.walk") }
                WiFiProbeView(probe:probe)
                    .tabItem { Label("Wi-Fi замер", systemImage: "waveform.path.ecg") }
                WiFiSpectrumView()
                    .tabItem { Label("Wi-Fi эфир", systemImage: "wifi") }
            }
            .onOpenURL { url in probe.receive(url:url) }
        }
    }
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
    @Published var surveyID = UUID().uuidString
    @Published var router = CGPoint(x: 0.5, y: 0.5)
    @Published var phone = CGPoint(x: 0.66, y: 0.56)
    @Published var trail: [CGPoint] = []
    @Published var points: [WalkSample] = []
    @Published var meters: Double = 0
    @Published var steps: Int = 0
    @Published var headingDegrees: Double = 0
    @Published var status = "Укажите положение роутера"
    @Published var logging: [String] = []
    @Published var testing = false
    @Published var pedometerEnabled = false
    @Published var compassHeading: Double?
    @Published var compassAccuracy: Double?
    @Published var compassAligned = false
    @Published var manualDirectionSelected = false
    @Published var unmappedMeters = 0.0
    @Published var lastBatchSteps = 0
    @Published var lastPedometerAt: Date?
    @Published var correctingPosition = false
    @Published var directionSource = "Ручное ↑"
    @Published var mapMeters: Double = 16
    var metersToRouter: Double {
        hypot((phone.x - router.x) * mapMeters, (phone.y - router.y) * mapMeters)
    }
    var directionDegrees: Double {
        if compassAligned, let heading = compassHeading,
           let accuracy = compassAccuracy, (0...35).contains(accuracy),
           let reference = compassReference {
            return (heading - reference + 360).truncatingRemainder(dividingBy: 360)
        }
        return headingDegrees
    }

    private let pedometer = CMPedometer()
    private let headingReader = NetCheckHeadingReader()
    private var compassReference: Double?
    private var lastHeadingLoggedAt = Date.distantPast
    private var lastTrackLoggedAt = Date.distantPast
    private var lastBorderLoggedAt = Date.distantPast
    private var lastUnmappedLoggedAt = Date.distantPast
    private var timer: Timer?
    private var lastMotionAt = Date()
    private var lastRecordedDistance: Double = 0
    private var lastPaintedDistance: Double = 0
    private var didReachThreshold = false
    private var lastSampleAt = Date()
    let logURL: URL

    init() {
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        logURL = dir.appendingPathComponent("NetCheck-WalkTest-logs.txt")
        if let previous = try? String(contentsOf: logURL, encoding: .utf8) {
            logging = Array(previous.components(separatedBy: .newlines).filter { !$0.isEmpty }.suffix(100))
        }
        log("APP_LAUNCH", "Запуск приложения, v0.3.6 SHORTCUTS_PROBE")
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
        if step == .recording && correctingPosition {
            phone = p
            trail = [p] // do not imply a straight-line walk to a manually corrected location
            correctingPosition = false
            log("POSITION_CORRECTED", "x=\(p.x), y=\(p.y), live trail restarted")
            status = "Позиция исправлена, продолжайте обход"
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

    // One-tap live walking. Every sensor is checked and logged before starting.
    // No sensor can modify the plan without step updates from CMPedometer.
    func start() {
        log("START_BUTTON_TAP", "phase=\(step)")
        guard step == .ready || step == .finished else {
            log("START_REJECTED", "phase=\(step)")
            return
        }
        log("START_ACCEPTED", "LIVE_WALK")
        surveyID = UUID().uuidString
        step = .recording
        meters = 0
        steps = 0
        pedometerEnabled = false
        lastRecordedDistance = 0
        lastPaintedDistance = 0
        didReachThreshold = false
        lastMotionAt = Date()
        lastSampleAt = Date()
        trail = [phone]
        points.removeAll()
        // Retain an explicitly calibrated magnetic reference between consecutive
        // walks on the SAME plan. No implicit calibration or invented heading.
        if compassAligned, compassReference != nil {
            log("COMPASS_REFERENCE_REUSED", "retained for the same map; no new calibration requested")
        } else {
            compassAligned = false
            compassReference = nil
        }
        manualDirectionSelected = false
        unmappedMeters = 0
        lastBatchSteps = 0
        lastPedometerAt = nil
        compassHeading = nil
        compassAccuracy = nil
        correctingPosition = false
        directionSource = compassAligned ? "Компас (ожидаем показания)" : "Нет калибровки"
        status = compassAligned
            ? "Обход начат. Калибровка компаса сохранена, ожидаем показания."
            : "Обход начат. Нажмите «Совместить компас», прежде чем идти."
        log("SURVEY_LIVE_READY", "mapMeters=\(Int(mapMeters)); compassAligned=\(compassAligned); direction \(directionSource); positionAccuracy=UNKNOWN")
        Task { @MainActor [weak self] in
            guard let self = self, self.step == .recording else { return }
            self.enablePedometer()
            self.enableCompass()
            await self.measure(reason: "baseline")
        }
    }

    func enableCompass() {
        guard step == .recording else { return }
        guard let usage = Bundle.main.object(forInfoDictionaryKey: "NSLocationWhenInUseUsageDescription") as? String,
              !usage.isEmpty else {
            log("COMPASS_DISABLED", "privacy key missing")
            return
        }
        headingReader.onHeading = { [weak self] heading, accuracy in
            Task { @MainActor [weak self] in self?.acceptHeading(heading, accuracy: accuracy) }
        }
        headingReader.onFailure = { [weak self] reason in
            Task { @MainActor [weak self] in self?.log("COMPASS_ERROR", reason) }
        }
        log("COMPASS_START", "user may be asked for Location permission; no GPS location is read")
        headingReader.begin()
    }

    private func acceptHeading(_ heading: Double, accuracy: Double) {
        guard step == .recording else { return }
        if !heading.isFinite || accuracy < 0 {
            compassAccuracy = nil
            if Date().timeIntervalSince(lastHeadingLoggedAt) > 12 {
                lastHeadingLoggedAt = Date()
                log("HEADING_INVALID", "poor accuracy or calibration")
            }
            return
        }
        compassHeading = heading
        compassAccuracy = accuracy
        if Date().timeIntervalSince(lastHeadingLoggedAt) > 10 {
            lastHeadingLoggedAt = Date()
            log("HEADING_UPDATE", "phoneTop=\(Int(heading))deg, accuracy=±\(Int(accuracy))deg")
        }
    }

    func alignCompass() {
        guard step == .recording else { return }
        guard let heading = compassHeading, let accuracy = compassAccuracy,
              (0...35).contains(accuracy) else {
            log("COMPASS_ALIGN_UNAVAILABLE", "heading absent or accuracy >35 degrees")
            status = "Компас неточен: разверните телефон и попробуйте снова"
            return
        }
        compassReference = heading
        compassAligned = true
        manualDirectionSelected = false
        lastPaintedDistance = meters // no phantom jump for steps before calibration
        directionSource = "Компас (ориентация телефона)"
        log("COMPASS_CALIBRATED", "phoneTop aligned to map UP, accuracy=±\(Int(accuracy))deg")
        status = "Калибровка выполнена. Держите верх телефона по ходу движения."
    }

    func toggleCorrection() {
        guard step == .recording else { return }
        correctingPosition.toggle()
        log("POSITION_CORRECTION_MODE", correctingPosition ? "tap map to relocate phone" : "off")
    }

    func setScale(_ size: Double) {
        guard step != .recording, [8.0, 16.0, 24.0].contains(size) else { return }
        mapMeters = size
        log("MAP_SCALE_SELECTED", "both axes \(Int(size))m; estimated, not surveyed")
    }

    func enablePedometer() {
        log("PEDOMETER_BUTTON_TAP", "phase=\(step)")
        guard step == .recording else {
            log("PEDOMETER_REJECTED", "survey not recording")
            return
        }
        guard !pedometerEnabled else {
            log("PEDOMETER_ALREADY_ACTIVE", "no second activation")
            return
        }
        let motionKey = Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") as? String
        guard let key = motionKey, !key.isEmpty else {
            status = "Не найден ключ доступа к датчикам движения"
            log("PEDOMETER_DISABLED", "NSMotionUsageDescription missing in installed application")
            return
        }
        log("MOTION_PRIVACY_KEY", "present")
        let available = CMPedometer.isStepCountingAvailable()
        log("MOTION_CAPABILITY", "stepCounter=\(available)")
        guard available else {
            status = "Шагомер недоступен; используйте ручные замеры"
            log("PEDOMETER_DISABLED", "hardware unavailable")
            return
        }
        lastMotionAt = Date()
        pedometerEnabled = true
        log("PEDOMETER_START", "explicit user request")
        pedometer.startUpdates(from: Date()) { [weak self] data, error in
            Task { @MainActor [weak self] in
                guard let self = self, self.step == .recording else { return }
                if let error = error {
                    self.log("MOTION_ERROR", error.localizedDescription)
                    self.status = "Ошибка шагомера — ручной замер доступен"
                    return
                }
                if let data = data {
                    self.accept(steps: data.numberOfSteps.intValue,
                                distance: data.distance?.doubleValue,
                                endDate: data.endDate)
                }
            }
        }
        log("PEDOMETER_START_RETURNED", "CoreMotion API returned")
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        status = "Шагомер включён. Пройдите 3 м и остановитесь на 5 секунд."
    }

    private func accept(steps newSteps: Int, distance: Double?, endDate: Date) {
        guard step == .recording else { return }
        let previousSteps = steps
        let newDistance = max(meters, distance ?? Double(newSteps) * 0.7)
        if newSteps != steps || newDistance > meters + 0.06 {
            lastMotionAt = Date()
        }
        steps = newSteps
        meters = newDistance
        if newSteps != previousSteps {
            let batch = max(0, newSteps - previousSteps)
            lastBatchSteps = batch
            lastPedometerAt = Date()
            let age = max(0, Date().timeIntervalSince(endDate))
            log("PEDOMETER_BATCH", "batchSteps=\(batch), total=\(steps), meters=\(String(format: "%.2f", meters)), sampleAgeSec=\(String(format: "%.1f", age))")
        }

        let delta = newDistance - lastPaintedDistance
        if delta > 0.10 {
            // Mark all measured distance as consumed, even if compass is not ready.
            // When calibration becomes available, previous steps must NOT jump forward.
            lastPaintedDistance = newDistance
            let compassOK = compassAligned && compassReference != nil &&
                compassHeading != nil &&
                compassAccuracy.map({ (0...35).contains($0) }) == true
            if !compassOK && !manualDirectionSelected {
                unmappedMeters += delta
                directionSource = compassAligned ? "Компас пока неточен" : "Нет калибровки"
                status = "Шаги учтены, но направление неизвестно. Совместите компас ↑."
                if Date().timeIntervalSince(lastUnmappedLoggedAt) > 4 {
                    lastUnmappedLoggedAt = Date()
                    log("WALK_NOT_MAPPED",
                        "measured=\(String(format: "%.2f", delta))m, totalUnmapped=\(String(format: "%.2f", unmappedMeters))m, reason=\(directionSource)")
                }
            } else {
                let direction = compassOK ? directionDegrees : headingDegrees
                let radians = direction * .pi / 180
                let wantedX = phone.x + sin(radians) * delta / mapMeters
                let wantedY = phone.y - cos(radians) * delta / mapMeters
                let x = min(max(wantedX, 0.03), 0.97)
                let y = min(max(wantedY, 0.03), 0.97)
                if (x != wantedX || y != wantedY) &&
                    Date().timeIntervalSince(lastBorderLoggedAt) > 10 {
                    lastBorderLoggedAt = Date()
                    log("TRACK_MAP_EDGE", "marker constrained to plan border")
                }
                phone = CGPoint(x: x, y: y)
                trail.append(phone)
                directionSource = compassOK ? "Компас (оценка)" : "Ручное направление (оценка)"
                if Date().timeIntervalSince(lastTrackLoggedAt) > 1 {
                    lastTrackLoggedAt = Date()
                    log("LIVE_WALK_UPDATE",
                        "steps=\(steps), walked=\(String(format: "%.2f", meters))m, angle=\(Int(direction))deg, source=\(directionSource), x=\(String(format: "%.3f", x)), y=\(String(format: "%.3f", y))")
                }
            }
        }
        if meters - lastRecordedDistance >= 3 && !didReachThreshold {
            didReachThreshold = true
            log("DISTANCE_THRESHOLD", "meters=\(String(format: "%.2f", meters))")
            status = "Пройдено 3 м. Остановитесь на 5 секунд."
        }
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
        manualDirectionSelected = true
        lastPaintedDistance = meters // never retroactively map earlier steps
        directionSource = "Ручное направление (оценка)"
        log("HEADING_MANUAL", "direction=\(headingDegrees), compass disabled")
    }

    func manualMeasurement() {
        guard step == .recording || step == .finished else { return }
        Task { await measure(reason: "manual") }
    }

    func measure(reason: String) async {
        guard !testing else { return }
        testing = true
        let point = phone
        log("PROBE_STARTED", reason)
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
        headingReader.end()
        // Keep calibration for another survey without resetting the topology.
        if pedometerEnabled { pedometer.stopUpdates() }
        pedometerEnabled = false
        timer?.invalidate()
        timer = nil
        step = .finished
        status = "Обследование завершено. Точек: \(points.count)"
        log("SURVEY_FINISHED", "steps=\(steps), meters=\(meters), points=\(points.count)")
    }

    func restart() {
        headingReader.end()
        compassAligned = false
        compassReference = nil
        manualDirectionSelected = false
        if pedometerEnabled { pedometer.stopUpdates() }
        pedometerEnabled = false
        timer?.invalidate()
        timer = nil
        step = .router
        unmappedMeters = 0
        lastBatchSteps = 0
        lastPedometerAt = nil
        correctingPosition = false
        trail.removeAll()
        points.removeAll()
        status = "Укажите положение роутера"
        log("SURVEY_RESET", "new map")
    }
}

struct WalkScreen: View {
    @ObservedObject var probe: WiFiProbeStore
    @StateObject private var model = WalkModel()
    @State private var showLogs = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    HStack {
                        Image(systemName: "wifi.router.fill")
                            .foregroundStyle(.blue)
                        Text("NetCheck Explorer 0.3.6").font(.title2.bold())
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
                                .stroke(.teal, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round, dash: [5, 3]))
                                ForEach(Array(model.points.enumerated()), id: \.element.id) { idx, sample in
                                    Circle().fill(sample.milliseconds == nil ? .red : .green)
                                        .frame(width: 13, height: 13)
                                        .position(x: sample.position.x * proxy.size.width,
                                                  y: sample.position.y * proxy.size.height)
                                }
                                ForEach(probe.samplesForSurvey(model.surveyID)) { sample in
                                    if let x = sample.x, let y = sample.y {
                                        Circle()
                                            .fill(sample.snr.map { $0 >= 25 ? Color.green : Color.orange } ?? Color.blue)
                                            .frame(width:12,height:12)
                                            .overlay(Circle().stroke(.white,lineWidth:2))
                                            .position(x:x * proxy.size.width,
                                                      y:y * proxy.size.height)
                                    }
                                }
                                Image(systemName: "wifi.router.fill")
                                    .font(.title3)
                                    .foregroundStyle(.blue)
                                    .padding(9)
                                    .background(.white, in: Circle())
                                    .position(x: model.router.x * proxy.size.width,
                                              y: model.router.y * proxy.size.height)
                                ZStack {
                                    Circle()
                                        .stroke(.teal.opacity(0.35), style: StrokeStyle(lineWidth: 2, dash: [4, 4]))
                                        .frame(width: 58, height: 58)
                                    Image(systemName: "figure.walk")
                                        .font(.system(size: 21, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .frame(width: 38, height: 38)
                                        .background(.teal, in: Circle())
                                }
                                .rotationEffect(.degrees(model.step == .recording ? model.directionDegrees : 0))
                                .position(x: model.phone.x * proxy.size.width,
                                          y: model.phone.y * proxy.size.height)
                                .animation(.linear(duration: 1.0), value: model.phone)
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
                    Text("Пунктир — оценка вашей ходьбы по шагомеру и компасу, а не точные координаты. Положение можно исправить касанием.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Text("Размер условного плана:").font(.caption)
                        ForEach([8.0, 16.0, 24.0], id: \.self) { scale in
                            Button("\(Int(scale)) м") { model.setScale(scale) }
                                .buttonStyle(.bordered)
                                .tint(model.mapMeters == scale ? .teal : .gray)
                                .disabled(model.step == .recording)
                        }
                    }
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
                            Button("Замер HTTP") { model.manualMeasurement() }
                                .buttonStyle(.bordered)
                            Button("Завершить") { model.finish() }
                                .buttonStyle(.borderedProminent)
                        }
                        Spacer(minLength: 0)
                        Button("Сбросить") { model.restart() }
                            .buttonStyle(.bordered)
                    }
                    if model.step == .recording {
                        VStack(alignment:.leading,spacing:5) {
                            Button {
                                probe.start(x:model.phone.x,y:model.phone.y,
                                            meters:model.meters,surveyID:model.surveyID)
                            } label: {
                                Label("Снять Wi-Fi RSSI / шум / канал в этой точке",systemImage:"waveform.path.ecg")
                                    .frame(maxWidth:.infinity)
                            }.buttonStyle(.borderedProminent)
                            Text(probe.status).font(.caption).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 8) {
                            Image(systemName: model.pedometerEnabled ? "figure.walk" : "figure.stand")
                                .foregroundStyle(model.pedometerEnabled ? .teal : .orange)
                            Text(model.pedometerEnabled ? "Шагомер активен" : "Шагомер недоступен")
                                .font(.subheadline)
                            Spacer()
                            if !model.pedometerEnabled {
                                Button("Повторить") { model.enablePedometer() }.buttonStyle(.bordered)
                            }
                        }
                        HStack(spacing: 10) {
                            Text("Компас: \(model.compassHeading.map { String(format: "%.0f°", $0) } ?? "нет")")
                            Text("±\(model.compassAccuracy.map { String(format: "%.0f°", $0) } ?? "?")")
                            Spacer()
                        }.font(.caption.monospacedDigit())
                        Text("Источник направления: \(model.directionSource)")
                            .font(.caption).foregroundStyle(.secondary)
                        if !model.compassAligned && !model.manualDirectionSelected {
                            Label("Траектория не строится, пока не задано направление.", systemImage: "exclamationmark.triangle.fill")
                                .font(.caption).foregroundStyle(.orange)
                        }
                        Text("Последняя порция шагомера: \(model.lastBatchSteps) шаг.; не гарантируется обновление на каждый шаг.")
                            .font(.caption).foregroundStyle(.secondary)
                        if model.unmappedMeters > 0.10 {
                            Text("Пройдено без направления: \(String(format: "%.1f", model.unmappedMeters)) м (на карте не рисуется)")
                                .font(.caption).foregroundStyle(.orange)
                        }
                        Button(model.compassAligned ? "↑ Калибровать компас заново" : "↑ Совместить компас с картой") {
                            model.alignCompass()
                        }
                            .buttonStyle(.borderedProminent)
                        Text("Нет компаса? Выберите направление стрелками ниже: оно будет приблизительным.")
                            .font(.caption).foregroundStyle(.secondary)
                        Text("Для калибровки направьте ВЕРХ телефона к ВЕРХУ карты и нажмите кнопку. Затем держите верх телефона по направлению движения. Поворот телефона сам по себе не равен повороту тела.")
                            .font(.caption).foregroundStyle(.secondary)
                        Button(model.correctingPosition ? "Коснитесь правильной позиции на плане" : "Исправить положение вручную") {
                            model.toggleCorrection()
                        }.buttonStyle(.bordered)
                    }
                    HStack {
                        metric("Шагов", "\(model.steps)")
                        metric("Пройдено", String(format: "%.1f м", model.meters))
                        metric("Точек", "\(model.points.count)")
                    }
                    if model.step == .recording || model.step == .finished {
                        Text("Wi-Fi радиозамеров на текущем обходе: \(probe.samplesForSurvey(model.surveyID).count)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    HStack {
                        Image(systemName: "location.north.line.fill").foregroundStyle(.teal)
                        Text("До роутера по схеме: ~\(String(format: "%.1f", model.metersToRouter)) м")
                            .font(.subheadline.monospacedDigit())
                        Spacer()
                    }
                    Text("Точность положения в помещении: НЕ ИЗМЕРЯЕТСЯ. Компас ±° показывает точность направления телефона, не координат.")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        Text("Направление следа:").font(.footnote)
                        Button("↶ 90°") { model.turn(-90) }.buttonStyle(.bordered)
                        Button("↷ 90°") { model.turn(90) }.buttonStyle(.bordered)
                        Text("\(Int(model.headingDegrees))°").font(.footnote.monospacedDigit())
                    }
                    Text("Шагомер передаёт данные порциями — маркер догоняет движение с задержкой. Компас измеряет направление телефона, не направление тела. Автозамер: 3 м + остановка 5 с.")
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
