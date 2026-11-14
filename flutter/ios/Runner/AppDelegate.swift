import AuthenticationServices
import Flutter
import Photos
import UIKit
import UniformTypeIdentifiers
import Vision

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    if let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "ChaekjangChannels") {
      ChaekjangChannels.register(with: registrar)
    }
  }
}

// 앱 전용 채널(Android MainActivity와 같은 이름·같은 약속). iOS에서 하는 일:
// - app.covebook/auth: 소셜 로그인 창(ASWebAuthenticationSession). 돌아온 chaekjang:// 주소를 돌려주고, 닫으면 nil
// - app.covebook/gallery: 공유 그림을 사진첩에 저장(추가 권한만)
// - app.covebook/files: 백업 파일 고르기(파일 앱). '다운로드 폴더에 저장'은 iOS에 없어 false(공유창의 '파일에 저장'을 쓴다)
// - app.covebook/text_recognition: 기기 안 문장 인식(Vision, 한국어는 iOS 16부터). 사진은 기기 밖으로 보내지 않는다
// 홈 화면 위젯(app.covebook/shelf_widget)은 Android만(Dart가 부르지 않는다)
final class ChaekjangChannels: NSObject, FlutterPlugin, ASWebAuthenticationPresentationContextProviding, UIDocumentPickerDelegate {
  private static var shared: ChaekjangChannels?
  private var session: ASWebAuthenticationSession?
  private var pickResult: FlutterResult?

  static func register(with registrar: FlutterPluginRegistrar) {
    let me = ChaekjangChannels()
    shared = me
    let m = registrar.messenger()
    FlutterMethodChannel(name: "app.covebook/auth", binaryMessenger: m).setMethodCallHandler { call, result in me.auth(call, result) }
    FlutterMethodChannel(name: "app.covebook/gallery", binaryMessenger: m).setMethodCallHandler { call, result in me.gallery(call, result) }
    FlutterMethodChannel(name: "app.covebook/files", binaryMessenger: m).setMethodCallHandler { call, result in me.files(call, result) }
    FlutterMethodChannel(name: "app.covebook/text_recognition", binaryMessenger: m).setMethodCallHandler { call, result in me.text(call, result) }
  }

  // MARK: 화면

  private static func keyWindow() -> UIWindow? {
    let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap { $0.windows }
    return windows.first { $0.isKeyWindow } ?? windows.first
  }

  private static func topController() -> UIViewController? {
    var vc = keyWindow()?.rootViewController
    while let next = vc?.presentedViewController { vc = next }
    return vc
  }

  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    return ChaekjangChannels.keyWindow() ?? ASPresentationAnchor()
  }

  // MARK: 로그인 창

  private func auth(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    guard call.method == "authenticate" else { result(FlutterMethodNotImplemented); return }
    guard let args = call.arguments as? [String: Any], let s = args["url"] as? String, let url = URL(string: s) else {
      result(FlutterError(code: "args", message: "url", details: nil))
      return
    }
    let scheme = (args["scheme"] as? String) ?? "chaekjang"
    session?.cancel()
    let next = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, _ in
      DispatchQueue.main.async {
        self?.session = nil
        result(callback?.absoluteString)
      }
    }
    next.presentationContextProvider = self
    next.prefersEphemeralWebBrowserSession = false
    session = next
    if !next.start() {
      session = nil
      result(nil)
    }
  }

  // MARK: 사진첩

  private func gallery(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    switch call.method {
    case "canSave":
      result(true)
    case "save":
      guard let args = call.arguments as? [String: Any], let path = args["path"] as? String else {
        result(FlutterError(code: "args", message: "path", details: nil))
        return
      }
      let name = (args["name"] as? String) ?? URL(fileURLWithPath: path).lastPathComponent
      PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
        guard status == .authorized || status == .limited else {
          DispatchQueue.main.async { result(FlutterError(code: "denied", message: "사진첩 권한이 없어요", details: nil)) }
          return
        }
        PHPhotoLibrary.shared().performChanges({
          PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: URL(fileURLWithPath: path))
        }) { ok, error in
          DispatchQueue.main.async {
            if ok { result(name) } else { result(FlutterError(code: "save", message: error?.localizedDescription, details: nil)) }
          }
        }
      }
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  // MARK: 백업 파일

  private func files(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    switch call.method {
    case "canSaveDownload":
      result(false)
    case "pick":
      guard let top = ChaekjangChannels.topController() else { result(nil); return }
      pickResult?(nil)
      pickResult = result
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.json, UTType.data], asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      top.present(picker, animated: true)
    default:
      result(FlutterMethodNotImplemented)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let done = pickResult
    pickResult = nil
    guard let url = urls.first else { done?(nil); return }
    // 앱 임시 폴더로 옮겨 넘긴다(Dart가 읽은 뒤 지운다)
    let dest = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("backup-\(UUID().uuidString).json")
    do {
      try? FileManager.default.removeItem(at: dest)
      try FileManager.default.copyItem(at: url, to: dest)
      done?(dest.path)
    } catch {
      done?(FlutterError(code: "read", message: error.localizedDescription, details: nil))
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pickResult?(nil)
    pickResult = nil
  }

  // MARK: 문장 인식

  private func text(_ call: FlutterMethodCall, _ result: @escaping FlutterResult) {
    guard call.method == "recognize" else { result(FlutterMethodNotImplemented); return }
    guard #available(iOS 16.0, *) else {
      result(FlutterError(code: "unavailable", message: "한국어 문장 인식은 iOS 16부터예요", details: nil))
      return
    }
    guard let path = call.arguments as? String, let image = UIImage(contentsOfFile: path), let cg = image.cgImage else {
      result(FlutterError(code: "read", message: "사진을 읽지 못했어요", details: nil))
      return
    }
    let orientation = ChaekjangChannels.cgOrientation(image.imageOrientation)
    // Vision 상자는 돌려 세운 그림 기준(0~1)이라 같은 기준의 크기로 화소 좌표를 만든다
    let sideways: Bool = [CGImagePropertyOrientation.left, .leftMirrored, .right, .rightMirrored].contains(orientation)
    let w = Double(sideways ? cg.height : cg.width)
    let h = Double(sideways ? cg.width : cg.height)
    DispatchQueue.global(qos: .userInitiated).async {
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["ko-KR", "en-US"]
      request.usesLanguageCorrection = true
      do {
        try VNImageRequestHandler(cgImage: cg, orientation: orientation, options: [:]).perform([request])
        var blocks: [[String: Any]] = []
        for obs in request.results ?? [] {
          guard let top = obs.topCandidates(1).first else { continue }
          let b = obs.boundingBox
          let x0 = Double(b.minX), x1 = Double(b.maxX), y0 = Double(b.minY), y1 = Double(b.maxY)
          let line: [String: Any] = [
            "text": top.string,
            "left": Int((x0 * w).rounded()),
            "top": Int(((1 - y1) * h).rounded()),
            "right": Int((x1 * w).rounded()),
            "bottom": Int(((1 - y0) * h).rounded()),
            "confidence": Double(top.confidence),
          ]
          blocks.append(["text": top.string, "lines": [line]])
        }
        let out: [String: Any] = ["width": Int(w), "height": Int(h), "blocks": blocks]
        DispatchQueue.main.async { result(out) }
      } catch {
        DispatchQueue.main.async { result(FlutterError(code: "recognize", message: error.localizedDescription, details: nil)) }
      }
    }
  }

  private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .upMirrored: return .upMirrored
    case .down: return .down
    case .downMirrored: return .downMirrored
    case .left: return .left
    case .leftMirrored: return .leftMirrored
    case .right: return .right
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
