
import SwiftUI
import CoreMotion
import Foundation

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
    @Published var headingDegrees: Double = 0
    @Published var status = "Укажите положение роутера"
    @Published var logging: [String] = []
    @Published var testing = false

    private let pedometer = CMPedometer()
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
        log("APP_LAUNCH", "Запуск приложения, v0.3.1 iPhone test")
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
        log("SURVEY_STARTED", "trigger=3m+5s, map=16m")
        status = "Обход начат. Идите с телефоном"
        let motionKey = Bundle.main.object(forInfoDictionaryKey: "NSMotionUsageDescription") as? String
        let pedometerAvailable = CMPedometer.isStepCountingAvailable()
        if pedometerAvailable, let key = motionKey, !key.isEmpty {
            log("MOTION_PRIVACY_KEY", "present")
            log("PEDOMETER_START", "requesting updates")
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
        } else {
            log("PEDOMETER_DISABLED", "available=\(pedometerAvailable), privacyKey=\(motionKey != nil)")
            status = "Шагомер недоступен — можно выполнять ручные замеры"
        }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        Task { await measure(reason: "baseline") }
    }

    private func accept(steps newSteps: Int, distance: Double?) {
        let newDistance = max(meters, distance ?? Double(newSteps) * 0.7)
        if newSteps != steps || newDistance > meters + 0.06 {
            lastMotionAt = Date()
        }
        steps = newSteps
        meters = newDistance
        let delta = newDistance - lastPaintedDistance
        if delta > 0.10 {
            let radians = headingDegrees * .pi / 180.0
            let dx = cos(radians) * delta / mapMeters
            let dy = sin(radians) * delta / mapMeters
            phone = CGPoint(x: min(max(phone.x + dx, 0.03), 0.97),
                            y: min(max(phone.y + dy, 0.03), 0.97))
            trail.append(phone)
            lastPaintedDistance = newDistance
        }
        if meters - lastRecordedDistance >= 3, !didReachThreshold {
            didReachThreshold = true
            log("DISTANCE_THRESHOLD", "meters=\(String(format: "%.2f", meters))")
            status = "Пройдено 3 м. Остановитесь на 5 секунд"
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
        log("HEADING_MANUAL", "direction=\(headingDegrees), estimated direction only")
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
        pedometer.stopUpdates()
        timer?.invalidate()
        timer = nil
        step = .finished
        status = "Обследование завершено. Точек: \(points.count)"
        log("SURVEY_FINISHED", "steps=\(steps), meters=\(meters), points=\(points.count)")
    }

    func restart() {
        pedometer.stopUpdates()
        timer?.invalidate()
        timer = nil
        step = .router
        trail.removeAll()
        points.removeAll()
        status = "Укажите положение роутера"
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
                                .stroke(.teal, style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
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
                    HStack {
                        Text("Направление следа:").font(.footnote)
                        Button("↶ 90°") { model.turn(-90) }.buttonStyle(.bordered)
                        Button("↷ 90°") { model.turn(90) }.buttonStyle(.bordered)
                        Text("\(Int(model.headingDegrees))°").font(.footnote.monospacedDigit())
                    }
                    Text("Автоматический замер: после 3 м пути и 5 секунд без новых шагов. Это HTTP-задержка, не ICMP и не RSSI.")
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
