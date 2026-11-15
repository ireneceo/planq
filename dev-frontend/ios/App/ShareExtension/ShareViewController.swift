import UIKit
import UniformTypeIdentifiers

// 다른 앱의 «공유» → PlanQ (#434 ② iOS). 설계 docs/NATIVE_SHARE_RECEIVE.md «iOS 상세 설계»
//
// 이 확장은 **넘겨주기만** 한다 — 대화방·프로젝트를 고르는 화면은 웹 /share-receive 하나다(결정 1).
//   ① 받은 항목을 정본 종류 목록과 대조해 App Group 컨테이너 group.app.planq/share-in/<ts>/ 에 «파일째» 복사
//      (loadFileRepresentation — 메모리에 올리지 않는다. 확장 메모리 한도 약 120MB) + manifest.json
//   ② planq://share 로 본 앱을 연다 → 열리면 completeRequest.
//      못 열면(애플이 막은 iOS 판) «PlanQ 앱을 열면 이어서 고를 수 있어요» + [PlanQ 열기][닫기] — 받은 것은 남는다.
//   본 앱 ShareReceivePlugin.takePending 이 App Group 을 직접 읽는 것이 정본이고 planq://share 는 신호일 뿐이다.
//
// 한도 = 안드로이드 ShareReceivePlugin.java 와 같다: 파일당 50MB · 합 100MB · 10개. 넘거나 종류가 안 맞으면 skipped.
// ★ 파일 시각·UserDefaults 를 쓰지 않는다(프라이버시 매니페스트 — 결정 7). 묶음 나이는 폴더 이름(ts, ms)으로 본다.

private let appGroupId = "group.app.planq"
private let shareDirName = "share-in"
private let maxFileBytes: Int64 = 50 * 1024 * 1024
private let maxTotalBytes: Int64 = 100 * 1024 * 1024
private let maxFiles = 10
private let bundleTTLms: Double = 10 * 60 * 1000

// 정본 목록(public/manifest.json share_target.accept)의 UTType. 하나를 바꾸면 셋(웹·안드로이드·여기)을 같이 바꾼다.
private let acceptTypes: [UTType] = {
    var list: [UTType] = [.image, .pdf, .plainText, .zip]
    for id in [
        "com.microsoft.word.doc",
        "org.openxmlformats.wordprocessingml.document",
        "com.microsoft.excel.xls",
        "org.openxmlformats.spreadsheetml.sheet",
        "com.pkware.zip-archive",
    ] {
        if let t = UTType(id) { list.append(t) }
    }
    return list
}()

private func isKorean() -> Bool {
    return (Locale.preferredLanguages.first ?? "en").lowercased().hasPrefix("ko")
}

private func L(_ ko: String, _ en: String) -> String { isKorean() ? ko : en }

// ★ @objc(이름) 을 붙이지 않는다 — Info.plist 의 NSExtensionPrincipalClass 가 «모듈.ShareViewController» 로 찾는다.
class ShareViewController: UIViewController {

    private struct SavedFile { let name: String; let mime: String; let size: Int64; let file: String }

    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let openButton = UIButton(type: .system)
    private let closeButton = UIButton(type: .system)

    private var bundleDir: URL?
    private var saved: [SavedFile] = []
    private var skipped = 0
    private var totalBytes: Int64 = 0
    private var texts: [String] = []
    private var title_ = ""
    private var started = false
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        buildUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !started else { return }
        started = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.collect() }
    }

    // MARK: - 화면 (거의 없음)

    private func buildUI() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.35)
        let card = UIView()
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        statusLabel.text = L("PlanQ 로 보내는 중…", "Sending to PlanQ…")
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.font = .preferredFont(forTextStyle: .body)
        statusLabel.textColor = .label
        spinner.startAnimating()

        openButton.setTitle(L("PlanQ 열기", "Open PlanQ"), for: .normal)
        openButton.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        openButton.addTarget(self, action: #selector(onOpen), for: .touchUpInside)
        openButton.isHidden = true
        closeButton.setTitle(L("닫기", "Close"), for: .normal)
        closeButton.addTarget(self, action: #selector(onClose), for: .touchUpInside)
        closeButton.isHidden = true

        let buttons = UIStackView(arrangedSubviews: [closeButton, openButton])
        buttons.axis = .horizontal
        buttons.distribution = .fillEqually
        buttons.spacing = 12
        let stack = UIStackView(arrangedSubviews: [spinner, statusLabel, buttons])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 300),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            openButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            closeButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
        ])
    }

    private func showFallback(_ message: String, canOpen: Bool) {
        DispatchQueue.main.async {
            self.spinner.stopAnimating()
            self.spinner.isHidden = true
            self.statusLabel.text = message
            self.openButton.isHidden = !canOpen
            self.closeButton.isHidden = false
        }
    }

    @objc private func onOpen() { openHostApp() }

    @objc private func onClose() { finish() }

    private func finish() {
        DispatchQueue.main.async {
            guard !self.finished else { return }
            self.finished = true
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }

    // MARK: - ① 받기 → App Group 에 복사

    private func shareRoot() -> URL? {
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent(shareDirName, isDirectory: true)
    }

    /// 10분 지난 묶음 삭제 — App Group 은 OS 가 비워 주지 않는다(결정 3). 폴더 이름 = 만든 시각(ms).
    private func sweepOld(_ root: URL, now: Double) {
        guard let items = try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for dir in items {
            let ts = Double(dir.lastPathComponent) ?? 0
            if now - ts > bundleTTLms { try? FileManager.default.removeItem(at: dir) }
        }
    }

    private func collect() {
        let now = Date().timeIntervalSince1970 * 1000
        guard let root = shareRoot() else {
            // App Group 권한이 없는 빌드 — 받을 곳이 없다
            showFallback(L("PlanQ 로 보낼 수 없어요. 앱을 업데이트해 주세요.", "Can't send to PlanQ. Please update the app."), canOpen: false)
            return
        }
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        sweepOld(root, now: now)
        let dir = root.appendingPathComponent(String(Int64(now)), isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            showFallback(L("PlanQ 로 보낼 수 없어요.", "Can't send to PlanQ."), canOpen: false)
            return
        }
        bundleDir = dir

        var providers: [NSItemProvider] = []
        for case let item as NSExtensionItem in (extensionContext?.inputItems ?? []) {
            if title_.isEmpty, let t = item.attributedTitle?.string, !t.isEmpty { title_ = t }
            if let t = item.attributedContentText?.string, !t.isEmpty { texts.append(t) }
            providers.append(contentsOf: item.attachments ?? [])
        }

        // 항목을 하나씩 차례로 — 한도(개수·합계)를 순서대로 세고, 메모리에 여러 개를 동시에 올리지 않는다.
        for (i, p) in providers.enumerated() {
            let sem = DispatchSemaphore(value: 0)
            handle(p, index: i) { sem.signal() }
            // 제공자가 끝내 답하지 않는 경우(드묾) — 확장이 영영 멈추지 않게 항목당 60초
            if sem.wait(timeout: .now() + 60) == .timedOut { skipped += 1 }
        }

        writeManifest(dir: dir, ts: now)
        if saved.isEmpty && texts.isEmpty && title_.isEmpty {
            try? FileManager.default.removeItem(at: dir)
            showFallback(L("PlanQ 로 보낼 수 있는 항목이 없어요.", "Nothing here can be sent to PlanQ."), canOpen: false)
            return
        }
        DispatchQueue.main.async { self.openHostApp() }
    }

    private func handle(_ p: NSItemProvider, index: Int, done: @escaping () -> Void) {
        let types = p.registeredTypeIdentifiers.compactMap { UTType($0) }

        // 링크(파일이 아닌 URL) — 사파리 «공유». 글과 같이 웹 /share-receive 의 url 칸으로 간다.
        let isFileLike = types.contains { t in acceptTypes.contains { t.conforms(to: $0) } && !t.conforms(to: .plainText) }
        if !isFileLike, p.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
                if let u = data as? URL, !u.isFileURL { self?.texts.append(u.absoluteString) }
                else if let u = data as? URL, u.isFileURL { self?.copyFile(at: u, suggested: p.suggestedName, type: nil, index: index) }
                else { self?.skipped += 1 }
                done()
            }
            return
        }

        // 글(파일이 아닌 텍스트) — loadItem 은 글이면 String, 파일이면 URL 을 준다
        if !isFileLike, p.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
                if let s = data as? String { self?.texts.append(s) }
                else if let s = data as? NSAttributedString { self?.texts.append(s.string) }
                else if let u = data as? URL, u.isFileURL { self?.copyFile(at: u, suggested: p.suggestedName, type: .plainText, index: index) }
                else { self?.skipped += 1 }
                done()
            }
            return
        }

        // 파일 — 정본 목록에 맞는 첫 표현. 사진은 public.jpeg 표현이 있으면 그것을 먼저(HEIC 대신, 결정 6)
        var pick: UTType? = nil
        if types.contains(where: { $0.conforms(to: .image) }), types.contains(.jpeg) { pick = .jpeg }
        if pick == nil { pick = types.first { t in acceptTypes.contains { t.conforms(to: $0) } } }
        guard let type = pick else { skipped += 1; done(); return }
        if saved.count >= maxFiles { skipped += 1; done(); return }

        p.loadFileRepresentation(forTypeIdentifier: type.identifier) { [weak self] url, _ in
            // url 은 이 블록이 끝나면 지워지는 임시 파일 — 블록 안에서 복사한다
            if let u = url { self?.copyFile(at: u, suggested: p.suggestedName, type: type, index: index) }
            else { self?.skipped += 1 }
            done()
        }
    }

    private func copyFile(at src: URL, suggested: String?, type: UTType?, index: Int) {
        guard let dir = bundleDir else { skipped += 1; return }
        if saved.count >= maxFiles { skipped += 1; return }
        let size = Int64((try? src.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1)
        if size < 0 || size > maxFileBytes || totalBytes + size > maxTotalBytes { skipped += 1; return }

        // 이름: 제안 이름(확장자 없을 때가 많다) + 실제 받은 표현의 확장자(JPEG 표현이면 .jpeg)
        let ext = src.pathExtension.isEmpty ? (type?.preferredFilenameExtension ?? "") : src.pathExtension
        var base = (suggested?.isEmpty == false ? suggested! : src.deletingPathExtension().lastPathComponent)
        let baseExt = (base as NSString).pathExtension
        if !baseExt.isEmpty, !ext.isEmpty, baseExt.lowercased() != ext.lowercased(),
           UTType(filenameExtension: baseExt) != nil {
            base = (base as NSString).deletingPathExtension   // IMG_0001.HEIC 로 왔는데 JPEG 표현을 받은 경우
        }
        var name = baseExt.lowercased() == ext.lowercased() || ext.isEmpty ? base : "\(base).\(ext)"
        name = name.components(separatedBy: CharacterSet(charactersIn: "/\\:*?\"<>|\0")).joined(separator: "_")
        if name.isEmpty { name = "shared-\(index + 1)" }

        let fileName = "\(index)-\(name)"
        let dst = dir.appendingPathComponent(fileName)
        do {
            try FileManager.default.copyItem(at: src, to: dst)
        } catch {
            skipped += 1
            return
        }
        let mime = (type ?? UTType(filenameExtension: ext))?.preferredMIMEType ?? "application/octet-stream"
        totalBytes += size
        saved.append(SavedFile(name: name, mime: mime, size: size, file: fileName))
    }

    private func writeManifest(dir: URL, ts: Double) {
        let body: [String: Any] = [
            "title": title_,
            "text": texts.joined(separator: "\n"),
            "files": saved.map { ["name": $0.name, "mime": $0.mime, "size": $0.size, "file": $0.file] },
            "skipped": skipped,
            "ts": ts,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: body) {
            try? data.write(to: dir.appendingPathComponent("manifest.json"), options: .atomic)
        }
    }

    // MARK: - ② 본 앱 열기 (결정 2)

    /// 공유 확장에는 공식 openURL 이 없다 — 응답자 사슬의 UIApplication 에 open(_:options:completionHandler:) 를
    /// 셀렉터로 보낸다(옛 openURL: 셀렉터는 iOS 18 에서 죽었다). 셀렉터가 없으면 바로 폴백(크래시 금지).
    /// completeRequest 는 복사·manifest 가 끝난 뒤, open 의 결과(또는 2초 타임아웃)에서 부른다.
    private func openHostApp() {
        guard !finished, let url = URL(string: "planq://share") else { return }
        let fallback = L("PlanQ 앱을 열면 이어서 고를 수 있어요.\n앱을 직접 열어도 10분 안이면 이어집니다.",
                         "Open the PlanQ app to choose where it goes.\nOpening the app yourself within 10 minutes also works.")
        let sel = NSSelectorFromString("openURL:options:completionHandler:")
        var responder: UIResponder? = self
        var app: UIResponder? = nil
        while let r = responder {
            if r.isKind(of: UIApplication.self) { app = r; break }
            responder = r.next
        }
        guard let target = app, target.responds(to: sel) else {
            showFallback(fallback, canOpen: false)
            return
        }

        var answered = false
        let completion: @convention(block) (Bool) -> Void = { [weak self] ok in
            DispatchQueue.main.async {
                guard let self = self, !answered else { return }
                answered = true
                if ok { self.finish() } else { self.showFallback(fallback, canOpen: true) }
            }
        }
        typealias OpenFn = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, (@convention(block) (Bool) -> Void)?) -> Void
        let fn = unsafeBitCast(target.method(for: sel), to: OpenFn.self)
        fn(target, sel, url as NSURL, NSDictionary(), completion)

        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self = self, !answered else { return }
            answered = true
            self.showFallback(fallback, canOpen: true)
        }
    }
}
