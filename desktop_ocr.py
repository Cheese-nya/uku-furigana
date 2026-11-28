"""
macOS Apple Vision OCR helper for Uku Furigana (浮く).
Lazily imports PyObjC Vision & Quartz only on Darwin; gracefully reports unavailable on Windows/Linux.
"""

import sys
import time

MAX_OCR_IMAGE_BYTES = 25 * 1024 * 1024
ALLOWED_CONTENT_TYPES = ('image/jpeg', 'image/png', 'image/webp')


def _load_vision():
    if sys.platform != 'darwin':
        return None
    try:
        import Quartz  # type: ignore
        import Vision  # type: ignore
        from Foundation import NSData  # type: ignore
        return Quartz, Vision, NSData
    except Exception:
        return None


def is_apple_vision_available():
    """Return whether macOS Vision framework is usable in this process."""
    return _load_vision() is not None


def validate_ocr_request(content_type, body):
    """Validate HTTP request payload for `/api/native-ocr`; return (ok, error_code)."""
    ctype = (content_type or '').split(';')[0].strip().lower()
    if ctype not in ALLOWED_CONTENT_TYPES:
        return False, 'unsupported-content-type'
    if not body:
        return False, 'empty-body'
    if len(body) > MAX_OCR_IMAGE_BYTES:
        return False, 'payload-too-large'
    return True, ''


def recognize_image_bytes(image_bytes):
    """Run VNRecognizeTextRequest on raw image bytes and return top-left pixel boxes."""
    modules = _load_vision()
    if modules is None:
        return 501, {'ok': False, 'error': 'apple-vision-unavailable'}

    Quartz, Vision, NSData = modules
    start = time.monotonic()

    try:
        ns_data = NSData.dataWithBytes_length_(image_bytes, len(image_bytes))
        ci_image = Quartz.CIImage.imageWithData_(ns_data)
        if ci_image is None:
            return 400, {'ok': False, 'error': 'invalid-image'}

        extent = ci_image.extent()
        width = float(extent.size.width)
        height = float(extent.size.height)
        if width <= 0 or height <= 0:
            return 400, {'ok': False, 'error': 'invalid-image-dimensions'}

        request = Vision.VNRecognizeTextRequest.alloc().init()
        request.setRecognitionLevel_(Vision.VNRequestTextRecognitionLevelAccurate)
        request.setRecognitionLanguages_(['ja-JP', 'zh-Hans', 'en-US'])
        request.setUsesLanguageCorrection_(True)

        handler = Vision.VNImageRequestHandler.alloc().initWithCIImage_options_(ci_image, {})
        success, error = handler.performRequests_error_([request], None)
        if not success:
            return 500, {'ok': False, 'error': str(error or 'vision-request-failed')}

        boxes = []
        for observation in request.results() or []:
            candidates = observation.topCandidates_(1)
            if not candidates:
                continue
            top = candidates[0]
            text = str(top.string() or '').strip()
            if not text:
                continue
            bb = observation.boundingBox()
            px = float(bb.origin.x) * width
            pw = float(bb.size.width) * width
            ph = float(bb.size.height) * height
            py = (1.0 - float(bb.origin.y) - float(bb.size.height)) * height
            boxes.append({
                'x': px,
                'y': py,
                'width': pw,
                'height': ph,
                'text': text,
                'confidence': float(top.confidence()),
                'vertical': ph > pw * 1.15,
            })

        elapsed_ms = int(round((time.monotonic() - start) * 1000))
        return 200, {
            'ok': True,
            'width': width,
            'height': height,
            'boxes': boxes,
            'elapsedMs': elapsed_ms,
        }
    except Exception as exc:
        return 500, {'ok': False, 'error': str(exc)}
