"""Manual-payment subscriptions. No payment is charged by this endpoint."""
from http.server import BaseHTTPRequestHandler
import os, json, hmac, hashlib, base64, secrets, time, calendar
from datetime import datetime, timezone

PLANS = [{'months':1,'price':42},{'months':3,'price':108},{'months':6,'price':196},{'months':12,'price':328}]
AI_FILE_PLANS = [{'files':100,'price':300},{'files':500,'price':1200},{'files':1000,'price':2000}]

def encode(raw): return base64.urlsafe_b64encode(raw).decode().rstrip('=')
def verify_license(token):
    secret=os.getenv('LICENSE_SIGNING_SECRET','')
    if not secret: raise ValueError('الاشتراكات لم تُفعّل بعد.')
    try:
        body,signature=token.split('.')
        expected=encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest())
        if not hmac.compare_digest(signature,expected): raise ValueError()
        payload=json.loads(base64.urlsafe_b64decode(body+'='*(-len(body)%4)))
        if payload.get('version')!=1: raise ValueError()
        if payload.get('kind')=='ai_files':
            if payload.get('files') not in (10,100,500,1000): raise ValueError()
            if 'expires' in payload and payload.get('expires',0)<=time.time(): raise ValueError()
            return payload
        if payload.get('months') not in (1,3,6,12) or payload.get('expires',0)<=time.time(): raise ValueError()
        payload['kind']='pro'
        return payload
    except Exception: raise ValueError('الكود غير صحيح أو انتهت صلاحيته.')

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

def issue_ai_pack(files,reference):
    if files not in (100,500,1000): raise ValueError('باقة ملفات غير صحيحة.')
    payload={'version':1,'kind':'ai_files','id':secrets.token_hex(8),'files':files,'issued':int(time.time()),'reference':reference}
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
        self.respond(200,{'plans':PLANS,'aiFilePlans':AI_FILE_PLANS,'currency':'EGP','whatsapp':number,'ready':bool(os.getenv('LICENSE_SIGNING_SECRET') and os.getenv('SUBSCRIPTION_ADMIN_SECRET')),'freeLimits':{'files':5,'mb':25},'proLimits':{'files':40,'mb':100},'monthlyAiCredits':int(os.getenv('BDF_AI_MONTHLY_CREDITS','100'))})
    def do_POST(self):
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<8192:return self.respond(413,{'error':'الطلب أكبر من الحد.'})
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict):raise ValueError('طلب غير صحيح.')
            if data.get('action')=='verify':
                payload=verify_license(str(data.get('token','')))
                if payload.get('kind')=='ai_files': raise ValueError('ده كود رصيد ملفات AI، استخدم خانة تفعيل رصيد AI.')
                return self.respond(200,{'membership':payload})
            if data.get('action')=='verify_ai':
                payload=verify_license(str(data.get('token','')))
                if payload.get('kind')!='ai_files': raise ValueError('ده مش كود رصيد ملفات AI.')
                return self.respond(200,{'aiPack':payload})
            if data.get('action')=='issue':
                admin=os.getenv('SUBSCRIPTION_ADMIN_SECRET','')
                if not admin:return self.respond(503,{'error':'لوحة إصدار الاشتراكات لم تُفعّل بعد.'})
                if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+admin):return self.respond(401,{'error':'مفتاح الإدارة غير صحيح.'})
                months=data.get('months');reference=str(data.get('reference','')).strip()
                plan=next((p for p in PLANS if p['months']==months and type(months) is int),None)
                if not plan or not 3<=len(reference)<=100 or data.get('paid')!=plan['price'] or data.get('confirmed') is not True:raise ValueError('راجع المدة والمبلغ وتأكيد استلام الدفع ومرجع العملية.')
                token,payload=issue_license(months,reference)
                return self.respond(200,{'token':token,'membership':payload})
            if data.get('action')=='issue_ai':
                admin=os.getenv('SUBSCRIPTION_ADMIN_SECRET','')
                if not admin:return self.respond(503,{'error':'لوحة إصدار الاشتراكات لم تُفعّل بعد.'})
                if not hmac.compare_digest(self.headers.get('Authorization',''),'Bearer '+admin):return self.respond(401,{'error':'مفتاح الإدارة غير صحيح.'})
                files=data.get('files');reference=str(data.get('reference','')).strip()
                plan=next((p for p in AI_FILE_PLANS if p['files']==files and type(files) is int),None)
                if not plan or not 3<=len(reference)<=100 or data.get('paid')!=plan['price'] or data.get('confirmed') is not True:raise ValueError('راجع عدد الملفات والمبلغ وتأكيد استلام الدفع ومرجع العملية.')
                token,payload=issue_ai_pack(files,reference)
                return self.respond(200,{'token':token,'aiPack':payload})
            raise ValueError('عملية غير مدعومة.')
        except ValueError as err:self.respond(400,{'error':str(err) or 'طلب غير صحيح.'})
        except Exception:self.respond(400,{'error':'طلب غير صحيح.'})
    def log_message(self,*args):pass
