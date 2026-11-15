import Foundation
import UIKit
import Capacitor

// 다른 앱의 «공유» → PlanQ (#434 ② iOS) — 본 앱 쪽. 설계 docs/NATIVE_SHARE_RECEIVE.md «iOS 상세 설계» ③⑤
//
// 안드로이드 ShareReceivePlugin.java 와 **같은 이름·같은 메서드**다 — JS(services/nativeShare.ts)는 플랫폼을 가리지 않는다.
//   takePending()      App Group(group.app.planq/share-in/)의 **가장 최근 묶음 하나**(10분 안)를 앱 캐시 share-in/ 로 옮기고
//                      { title, text, files:[{path,name,mime,size}], skipped, ts } 를 돌려준 뒤 모든 묶음을 지운다. ← 정본
//   'shareReceived'    planq://share 로 열렸을 때 + 앱이 앞으로 나올 때 쏘는 «신호» 일 뿐(데이터 없음).
//                      콜드 스타트에 URL 이 리스너보다 먼저 와도 무해하다 — JS 가 시작할 때 takePending 을 부른다.
// 묶음은 공유 확장(ShareExtension/ShareViewController.swift)이 쓴다: share-in/<ts ms>/manifest.json + 파일.
@objc(ShareReceivePlugin)
public class ShareReceivePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareReceivePlugin"
    public let jsName = "ShareReceive"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "takePending", returnType: CAPPluginReturnPromise)
    ]

    private let appGroupId = "group.app.planq"
    private let ttlMs: Double = 10 * 60 * 1000
    private let queue = DispatchQueue(label: "app.planq.share-receive")

    override public func load() {
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(onOpenURL(_:)), name: .capacitorOpenURL, object: nil)
        nc.addObserver(self, selector: #selector(onForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func onOpenURL(_ note: Notification) {
        guard let obj = note.object as? [String: Any], let url = obj["url"] as? URL,
              url.scheme?.lowercased() == "planq", url.host?.lowercased() == "share" else { return }
        notifyListeners("shareReceived", data: [:])
    }

    @objc private func onForeground() {
        // 공유 확장이 본 앱을 못 열었을 때 사용자가 앱을 직접 연 경우 — 묶음이 있을 때만 신호
        queue.async { [weak self] in
            guard let self = self, let root = self.shareRoot(),
                  let items = try? FileManager.default.contentsOfDirectory(atPath: root.path), !items.isEmpty else { return }
            DispatchQueue.main.async { self.notifyListeners("shareReceived", data: [:]) }
        }
    }

    private func shareRoot() -> URL? {
        return FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroupId)?
            .appendingPathComponent("share-in", isDirectory: true)
    }

    @objc func takePending(_ call: CAPPluginCall) {
        queue.async { [weak self] in
            call.resolve(self?.take() ?? [:])
        }
    }

    private func take() -> [String: Any] {
        let fm = FileManager.default
        guard let root = shareRoot(),
              let dirs = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return [:] }
        defer { for d in dirs { try? fm.removeItem(at: d) } }   // 옮긴 뒤 나머지(옛 묶음·두 번째 공유)는 모두 지운다

        // 가장 최근 묶음 = manifest.json 의 ts 가 가장 큰 것
        var best: (dir: URL, manifest: [String: Any], ts: Double)? = nil
        for d in dirs {
            guard let data = try? Data(contentsOf: d.appendingPathComponent("manifest.json")),
                  let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { continue }
            let ts = (m["ts"] as? NSNumber)?.doubleValue ?? 0
            if best == nil || ts > best!.ts { best = (d, m, ts) }
        }
        guard let pick = best else { return [:] }
        let now = Date().timeIntervalSince1970 * 1000
        if now - pick.ts > ttlMs { return [:] }

        // 앱 캐시 share-in/ — 지난 공유의 남은 파일은 지운다(안드로이드와 같다)
        guard let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first else { return [:] }
        let out = caches.appendingPathComponent("share-in", isDirectory: true)
        try? fm.removeItem(at: out)
        try? fm.createDirectory(at: out, withIntermediateDirectories: true)

        var files: [[String: Any]] = []
        var skipped = (pick.manifest["skipped"] as? NSNumber)?.intValue ?? 0
        for f in (pick.manifest["files"] as? [[String: Any]]) ?? [] {
            guard let file = f["file"] as? String, !file.contains("/"), !file.hasPrefix(".") else { skipped += 1; continue }
            let src = pick.dir.appendingPathComponent(file)
            let dst = out.appendingPathComponent(file)
            do { try fm.moveItem(at: src, to: dst) } catch { skipped += 1; continue }
            files.append([
                "path": dst.path,
                "name": (f["name"] as? String) ?? file,
                "mime": (f["mime"] as? String) ?? "application/octet-stream",
                "size": (f["size"] as? NSNumber)?.int64Value ?? 0,
            ])
        }
        return [
            "title": (pick.manifest["title"] as? String) ?? "",
            "text": (pick.manifest["text"] as? String) ?? "",
            "files": files,
            "skipped": skipped,
            "ts": pick.ts,
        ]
    }
}
