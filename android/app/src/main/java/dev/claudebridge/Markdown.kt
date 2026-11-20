package dev.claudebridge

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * Inline markdown only: bold, italic and code spans.
 *
 * Deliberately not a markdown library. What arrives here is a summary the Mac
 * already stripped of fenced code and tool output and capped at a couple of
 * hundred characters, so headings, lists, tables and links have nowhere to
 * appear. A parser for them would be a megabyte of dependency serving text
 * that cannot contain them.
 *
 * Unmatched markers are left alone rather than swallowed: a lone asterisk in
 * prose is far more common than a broken bold span, and eating it would be a
 * worse failure than showing it.
 */
fun inlineMarkdown(text: String): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        val marker = markerAt(text, i)
        if (marker == null) {
            append(text[i])
            i += 1
            continue
        }

        val contentStart = i + marker.token.length
        val close = text.indexOf(marker.token, contentStart)
        if (close < 0 || close == contentStart) {
            // No closing marker, or an empty span such as "**". Emit the
            // characters literally and carry on from just after them.
            append(marker.token)
            i = contentStart
            continue
        }

        withStyle(marker.style) { append(text.substring(contentStart, close)) }
        i = close + marker.token.length
    }
}

private class Marker(val token: String, val style: SpanStyle)

private val BOLD = SpanStyle(fontWeight = FontWeight.Bold)
private val ITALIC = SpanStyle(fontStyle = FontStyle.Italic)
private val CODE = SpanStyle(fontFamily = FontFamily.Monospace)

private fun markerAt(text: String, i: Int): Marker? = when {
    // Bold first: "**" would otherwise match as two italics.
    text.startsWith("**", i) -> Marker("**", BOLD)
    text.startsWith("*", i) -> Marker("*", ITALIC)
    text.startsWith("`", i) -> Marker("`", CODE)
    else -> null
}
