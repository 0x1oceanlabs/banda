"""Contrast and colour distance of the account colours (ADR 0093).

WCAG contrast, CIEDE2000 on sRGB, and Machado 2009 colour-blindness at
severity 1. Run: python3 -I colour.py
"""
import math, itertools
def hx(h): h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]
def lin(c): return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4
def delin(c): c=min(max(c,0),1); return 12.92*c if c<=0.0031308 else 1.055*c**(1/2.4)-0.055
def lum(h): r,g,b=[lin(x) for x in hx(h)]; return 0.2126*r+0.7152*g+0.0722*b
def cr(a,b): la,lb=sorted([lum(a),lum(b)],reverse=True); return (la+0.05)/(lb+0.05)
# Machado 2009, severity 1.0
M={'deutan':[[0.367322,0.860646,-0.227968],[0.280085,0.672501,0.047413],[-0.011820,0.042940,0.968881]],
   'protan':[[0.152286,1.052583,-0.204868],[0.114503,0.786281,0.099216],[-0.003882,-0.048116,1.051998]],
   'tritan':[[1.255528,-0.076749,-0.178779],[-0.078411,0.930809,0.147602],[0.004733,0.691367,0.303900]]}
def sim(h,k):
    if k=='normal': return hx(h)
    l=[lin(x) for x in hx(h)]; m=M[k]
    return [delin(sum(m[i][j]*l[j] for j in range(3))) for i in range(3)]
def lab(rgb):
    r,g,b=[lin(x) for x in rgb]
    X=(0.4124*r+0.3576*g+0.1805*b)/0.95047; Y=0.2126*r+0.7152*g+0.0722*b; Z=(0.0193*r+0.1192*g+0.9505*b)/1.08883
    f=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    return 116*f(Y)-16, 500*(f(X)-f(Y)), 200*(f(Y)-f(Z))
def de00(l1,l2):
    L1,a1,b1=l1;L2,a2,b2=l2
    C1=math.hypot(a1,b1);C2=math.hypot(a2,b2);Cb=(C1+C2)/2
    G=0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7)))
    a1p,a2p=a1*(1+G),a2*(1+G);C1p,C2p=math.hypot(a1p,b1),math.hypot(a2p,b2)
    h1=math.degrees(math.atan2(b1,a1p))%360;h2=math.degrees(math.atan2(b2,a2p))%360
    dL=L2-L1;dC=C2p-C1p
    dh=h2-h1
    if C1p*C2p==0: dh=0
    elif dh>180: dh-=360
    elif dh<-180: dh+=360
    dH=2*math.sqrt(C1p*C2p)*math.sin(math.radians(dh/2))
    Lb=(L1+L2)/2;Cbp=(C1p+C2p)/2
    hb=(h1+h2)/2 if abs(h1-h2)<=180 else (h1+h2+360)/2
    if C1p*C2p==0: hb=h1+h2
    T=1-0.17*math.cos(math.radians(hb-30))+0.24*math.cos(math.radians(2*hb))+0.32*math.cos(math.radians(3*hb+6))-0.20*math.cos(math.radians(4*hb-63))
    SL=1+0.015*(Lb-50)**2/math.sqrt(20+(Lb-50)**2);SC=1+0.045*Cbp;SH=1+0.015*Cbp*T
    RT=-2*math.sqrt(Cbp**7/(Cbp**7+25**7))*math.sin(math.radians(60*math.exp(-((hb-275)/25)**2)))
    return math.sqrt((dL/SL)**2+(dC/SC)**2+(dH/SH)**2+RT*(dC/SC)*(dH/SH))
THEMES={
 'light':{'bg':{'background':'#ffffff','sidebar':'#fafafa'},
   'cols':{'violet':'#8557c8','rose':'#ad3272','green':'#17a750','graphite':'#424242'},
   'own':{'claude':'#d97757','openai':'#18181b'}},
 'dark':{'bg':{'background':'#19191c','sidebar':'#202024'},
   'cols':{'violet':'#a072e6','rose':'#c54987','green':'#1eab53','graphite':'#b7b7b7'},
   'own':{'claude':'#d97757','openai':'#ededef'}},
}


# The palette ADR 0093 proposes, against each theme's sidebar.
P = {
    'light': {'bg': '#fafafa', 'violet': '#8557c8', 'rose': '#ad3272', 'green': '#189a69',
              'graphite': '#424242', 'claude': '#c96442', 'openai': '#18181b'},
    'dark': {'bg': '#202024', 'violet': '#a072e6', 'rose': '#c54987', 'green': '#15b77c',
             'graphite': '#b7b7b7', 'claude': '#d97757', 'openai': '#ededef'},
}

if __name__ == '__main__':
    for t, p in P.items():
        for fam in ['claude', 'openai']:
            cols = {'own': p[fam], **{k: p[k] for k in ['violet', 'rose', 'green', 'graphite']}}
            lo = min(cr(c, p['bg']) for c in cols.values())
            row = []
            for k in ['normal', 'deutan', 'protan', 'tritan']:
                m = min((de00(lab(sim(a[1], k)), lab(sim(b[1], k))), a[0], b[0])
                        for a, b in itertools.combinations(cols.items(), 2))
                row.append(f'{k} {m[0]:.1f} ({m[1]}-{m[2]})')
            print(f'{t:5} {fam:6} lowest contrast {lo:.2f} | ' + ' | '.join(row))
