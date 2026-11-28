import sys
import unittest
from unittest.mock import MagicMock, patch

import desktop_ocr


class DesktopOcrTests(unittest.TestCase):
    def test_validate_ocr_request_checks_mime_and_size(self):
        ok, err = desktop_ocr.validate_ocr_request('image/png; charset=utf-8', b'abc')
        self.assertTrue(ok)
        self.assertEqual(err, '')

        ok, err = desktop_ocr.validate_ocr_request('application/pdf', b'abc')
        self.assertFalse(ok)
        self.assertEqual(err, 'unsupported-content-type')

        ok, err = desktop_ocr.validate_ocr_request('image/jpeg', b'')
        self.assertFalse(ok)
        self.assertEqual(err, 'empty-body')

        huge = b'x' * (desktop_ocr.MAX_OCR_IMAGE_BYTES + 1)
        ok, err = desktop_ocr.validate_ocr_request('image/webp', huge)
        self.assertFalse(ok)
        self.assertEqual(err, 'payload-too-large')

    @unittest.skipIf(sys.platform == 'darwin', 'non-Darwin unavailability check')
    def test_non_darwin_reports_unavailable(self):
        self.assertFalse(desktop_ocr.is_apple_vision_available())
        status, payload = desktop_ocr.recognize_image_bytes(b'fake-jpeg')
        self.assertEqual(status, 501)
        self.assertEqual(payload.get('error'), 'apple-vision-unavailable')

    def test_mocked_vision_converts_bottom_left_bbox_to_top_left_pixels(self):
        mock_quartz = MagicMock()
        mock_extent = MagicMock()
        mock_extent.size.width = 1000.0
        mock_extent.size.height = 500.0
        mock_ci = MagicMock()
        mock_ci.extent.return_value = mock_extent
        mock_quartz.CIImage.imageWithData_.return_value = mock_ci

        mock_obs = MagicMock()
        mock_cand = MagicMock()
        mock_cand.string.return_value = 'テスト行'
        mock_cand.confidence.return_value = 0.94
        mock_obs.topCandidates_.return_value = [mock_cand]
        # Normalized Vision coords: origin.x=0.1, origin.y=0.7, size.width=0.4, size.height=0.1
        # Expected top-left pixels on 1000x500: x=100, w=400, h=50, y=(1 - 0.7 - 0.1)*500 = 100
        bb = MagicMock()
        bb.origin.x = 0.1
        bb.origin.y = 0.7
        bb.size.width = 0.4
        bb.size.height = 0.1
        mock_obs.boundingBox.return_value = bb

        mock_req = MagicMock()
        mock_req.results.return_value = [mock_obs]
        mock_vision = MagicMock()
        mock_vision.VNRecognizeTextRequest.alloc.return_value.init.return_value = mock_req
        mock_handler = MagicMock()
        mock_handler.performRequests_error_.return_value = (True, None)
        mock_vision.VNImageRequestHandler.alloc.return_value.initWithCIImage_options_.return_value = mock_handler

        mock_nsdata = MagicMock()
        mock_nsdata.dataWithBytes_length_.return_value = object()

        with patch.object(desktop_ocr, '_load_vision', return_value=(mock_quartz, mock_vision, mock_nsdata)):
            status, payload = desktop_ocr.recognize_image_bytes(b'jpeg-bytes')

        self.assertEqual(status, 200)
        self.assertTrue(payload['ok'])
        self.assertEqual(payload['width'], 1000.0)
        self.assertEqual(payload['height'], 500.0)
        self.assertEqual(len(payload['boxes']), 1)
        box = payload['boxes'][0]
        self.assertAlmostEqual(box['x'], 100.0)
        self.assertAlmostEqual(box['y'], 100.0)
        self.assertAlmostEqual(box['width'], 400.0)
        self.assertAlmostEqual(box['height'], 50.0)
        self.assertEqual(box['text'], 'テスト行')


if __name__ == '__main__':
    unittest.main()
