"""Manual-payment subscriptions. No payment is charged by this endpoint."""
from http.server import BaseHTTPRequestHandler
import os, json, hmac, hashlib, base64, secrets, time, calendar
from datetime import datetime, timezone

PLANS = [{'months':1,'price':19},{'months':3,'price':49},{'months':6,'price':89},{'months':12,'price':149}]

def encode(raw): return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def verify_license(token):
    secret=os.getenv('LICENSE_SIGNING_SECRET','')
    if not secret: raise ValueError('الاشتراكات لم تُفعّل بعد.')
    try:
        body,signature=token.split('.')
        expected=encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest())
        if not hmac.compare_digest(signature,expected): raise ValueError()
        payload=json.loads(base64.urlsafe_b64decode(body+'='*(-len(body)%4)))
        if payload.get('version')!=1 or payload.get('months') not in (1,3,6,12) or payload.get('expires',0)<=time.time(): raise ValueError()
        return payload
    except Exception: raise ValueError('كود الاشتراك غير صحيح أو انتهت صلاحيته.')

def issue_license(months,reference):
    now=datetime.now(timezone.utc)
    offset=now.month-1+months
    year=now.year+offset//12;month=offset%12+1
    expiry=now.replace(year=year,month=month,day=min(now.day,calendar.monthrange(year,month)[1]))
    payload={'version':1,'id':secrets.token_hex(8),'months':months,'issued':int(now.timestamp()),'expires':int(expiry.timestamp()),'reference':reference}
    body=encode(json.dumps(payload,separators=(',',':')).encode())
    secret=os.getenv('LICENSE_SIGNING_SECRET','')
    if not secret: raise ValueError('الاشتراكات لم تُفعّل بعد.')
    token=body+'.'+encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest())
    return token,payload

class handler(BaseHTTPRequestHandler):
    def respond(self,status,data):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def do_GET(self):
        number=os.getenv('SUPPORT_WHATSAPP','')
        if not number.isdigit() or not 8<=len(number)<=15:number=''
        self.respond(200,{'plans':PLANS,'currency':'EGP','whatsapp':number,'ready':bool(os.getenv('LICENSE_SIGNING_SECRET') and os.getenv('SUBSCRIPTION_ADMIN_SECRET'))})
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<8192:return self.respond(413,{'error':'الطلب أكبر من الحد.'})
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('طلب غير صحيح.')
            if data.get('action')=='verify':
                payload=verify_license(str(data.get('token','')))
                return self.respond(200,{'membership':payload})
            if data.get('action')=='issue':
                admin=os.getenv('SUBSCRIPTION_ADMIN_SECRET','')
                if not admin:return self.respond(503,{'error':'لوحة إصدار الاشتراكات لم تُفعّل بعد.'})
                if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+admin):return self.respond(401,{'error':'مفتاح الإدارة غير صحيح.'})
                months=data.get('months');reference=str(data.get('reference','')).strip()
                plan=next((p for p in PLANS if p['months']==months and type(months) is int),None)
                if not plan or not 3<=len(reference)<=100 or data.get('paid')!=plan['price'] or data.get('confirmed') is not True:raise ValueError('راجع المدة والمبلغ وتأكيد استلام الدفع ومرجع العملية.')
                token,payload=issue_license(months,reference)
                return self.respond(200,{'token':token,'membership':payload})
            raise ValueError('عملية غير مدعومة.')
        except ValueError as err:self.respond(400,{'error':str(err) or 'طلب غير صحيح.'})
        except Exception:self.respond(400,{'error':'طلب غير صحيح.'})
    def log_message(self,*args):pass
