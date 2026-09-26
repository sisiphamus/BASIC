package com.baseacademy.glasses

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import com.meta.wearable.dat.camera.types.PhotoData
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/** Glasses photo -> full-resolution JPEG, rotated upright. No resizing. */
object Photos {
  private const val QUALITY = 92

  fun toJpeg(photo: PhotoData): ByteArray? =
      when (photo) {
        is PhotoData.Bitmap -> encode(photo.bitmap)
        is PhotoData.HEIC -> {
          val buf = photo.data.duplicate().apply { rewind() }
          val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
          decodeUpright(bytes)?.let { bmp -> encode(bmp).also { bmp.recycle() } }
        }
      }

  fun encode(bitmap: Bitmap): ByteArray =
      ByteArrayOutputStream(bitmap.byteCount / 8).use { out ->
        bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, out)
        out.toByteArray()
      }

  // The glasses store orientation in EXIF, which the decoder doesn't apply for HEIC.
  private fun decodeUpright(bytes: ByteArray): Bitmap? {
    val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return null
    val orientation =
        runCatching {
              ByteArrayInputStream(bytes).use {
                ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
              }
            }
            .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
    val m = Matrix()
    when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      ExifInterface.ORIENTATION_TRANSPOSE -> {
        m.postRotate(90f)
        m.postScale(-1f, 1f)
      }
      ExifInterface.ORIENTATION_TRANSVERSE -> {
        m.postRotate(270f)
        m.postScale(-1f, 1f)
      }
    }
    if (m.isIdentity) return bmp
    return try {
      Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true).also { bmp.recycle() }
    } catch (e: OutOfMemoryError) {
      bmp
    }
  }
}
