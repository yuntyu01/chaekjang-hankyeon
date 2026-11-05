package app.covebook.screencapture

import android.content.Context
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

// 앱 시작 때 지난 홈 사진을 JS보다 먼저 띄운다(StartPhoto)
class ScreenCapturePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context): List<ReactActivityLifecycleListener> =
    listOf(StartPhotoListener)
}
