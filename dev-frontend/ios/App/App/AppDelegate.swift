import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        hideWebFormAccessoryBar()
        return true
    }

    // ── 키보드 위 ▲ ▼ ✓ 줄(폼 액세서리 바) 제거 (2026-09-11) ──
    // Irene: "키보드 올라오면 왜 위아래 화살표랑 우측에 체크 있는 기능이 나와? 다른 앱은 안나오는데
    //         이게 키보드 위에 붙어서 채팅내용을 더 못 보게 하는데."
    // 그 줄은 WKWebView 가 입력란마다 붙이는 것이다(네이티브 앱 입력란에는 없다). 웹 코드로는 못 끈다.
    //
    // ★ @capacitor/keyboard 플러그인을 쓰지 않는 이유: 그 플러그인은 load 때 WKWebView 자신의
    //   키보드 옵저버를 **떼어낸다**(removeObserver:self.webView ...). 그러면 키보드가 떠도
    //   visualViewport 가 줄지 않아, 채팅·모달이 기대는 --vvh(main.tsx) 가 통째로 멈춘다.
    //   resize:'native' 로 대신하면 키보드 애니메이션 + 0.2초 뒤에야 웹뷰가 줄어 입력란이 잠깐 가린다.
    //   우리가 원하는 것은 **바 하나만** 없애는 것이다 — 그 부분(inputAccessoryView → nil)만 가져온다.
    private func hideWebFormAccessoryBar() {
        guard let cls = NSClassFromString("WKContentView") else { return }
        let sel = #selector(getter: UIResponder.inputAccessoryView)
        guard let original = class_getInstanceMethod(cls, sel) else { return }
        let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
        let imp = imp_implementationWithBlock(unsafeBitCast(block, to: AnyObject.self))
        // WKContentView 가 직접 구현하고 있으면 그 구현만 바꾸고, 상속받고 있으면 이 클래스에만 덧붙인다
        // (상위 UIResponder 를 바꾸면 앱의 모든 응답자에 번진다).
        if !class_addMethod(cls, sel, imp, method_getTypeEncoding(original)) {
            method_setImplementation(original, imp)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // ── APNs 등록 콜백 (MOBILE_APP_DESIGN — @capacitor/push-notifications 필수) ──
    // 이 두 메서드가 없으면 device token 이 플러그인(JS)으로 전달되지 않아 registration 이벤트가
    // 영영 발화하지 않는다 → subscribe-native 미호출 → iOS 푸시 전면 무동작.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

}
