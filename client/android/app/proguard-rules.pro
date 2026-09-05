# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# minifyEnabled is currently false (see app/build.gradle), so R8 doesn't run
# today -- these rules are here defensively so that if minification is ever
# turned on later, it doesn't silently strip/rename this app's own native
# plugin classes, which Capacitor references by name via reflection and its
# generated plugin manifest rather than direct compiled references
# (GpsTrackerPlugin, GpsTrackerService, BootReceiver, GpsPermissionStatus,
# MainActivity).
-keep class com.sfotems.crew.** { *; }
-keep class * extends com.getcapacitor.Plugin
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin *;
    @com.getcapacitor.PluginMethod *;
}
