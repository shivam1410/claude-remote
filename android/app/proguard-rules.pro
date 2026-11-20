# kotlinx.serialization keeps its generated serializers through reflection on
# the companion; R8 cannot see that link.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class dev.claudebridge.** {
    *** Companion;
}
-keepclasseswithmembers class dev.claudebridge.** {
    kotlinx.serialization.KSerializer serializer(...);
}
