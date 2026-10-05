from http.server import BaseHTTPRequestHandler
from io import BytesIO
import json, base64, secrets
from pypdf import PdfReader, PdfWriter

MAX_BYTES = int(2.8 * 1024 * 1024)
def process(payload):
    action = payload.get('action')
    password = payload.get('password', '')
    if action not in ('protect', 'unlock') or not isinstance(password, str) or not password:
        raise ValueError('طلب غير صالح أو كلمة مرور فارغة.')
    if action == 'protect' and len(password) < 6:
        raise ValueError('استخدم كلمة مرور من 6 أحرف على الأقل.')
    try:
        data = base64.b64decode(payload.get('file', ''), validate=True)
    except Exception:
        raise ValueError('بيانات الملف غير صالحة.')
    if not data or len(data) > MAX_BYTES:
        raise ValueError('الحد الأقصى لهذه العملية 2.8 MB.')
    reader = PdfReader(BytesIO(data))
    if reader.is_encrypted:
        if action != 'unlock':
            raise ValueError('افتح الملف بكلمة مروره الحالية قبل إضافة حماية جديدة.')
        if not reader.decrypt(password):
            raise ValueError('كلمة المرور غير صحيحة.')
    writer = PdfWriter(clone_from=reader)
    if action == 'protect':
        writer.encrypt(password, owner_password=secrets.token_urlsafe(32), algorithm='AES-256')
    result = BytesIO()
    writer.write(result)
    if result.tell() > MAX_BYTES:
        raise ValueError('الناتج يتجاوز حد الخدمة؛ استخدم ملفًا أصغر.')
    return {'file': base64.b64encode(result.getvalue()).decode('ascii')}

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > 4 * 1024 * 1024:
                return self.respond(413, {'error': 'الملف أكبر من حد خدمة الحماية.'})
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise ValueError('طلب غير صالح.')
            self.respond(200, process(payload))
        except ValueError as e:
            self.respond(400, {'error': str(e)})
        except Exception:
            self.respond(400, {'error': 'تعذر معالجة الملف. تأكد من صلاحيته وكلمة مروره.'})
    def respond(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *args):
        pass
