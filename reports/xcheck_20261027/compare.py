import json,csv,collections,os
D='./'
m=json.load(open(D+'etc_rc.json'))
rows=[]
for i in range(3):
    lines=open(D+f'chunk{i}.txt').read().split('\n')
    lab=json.load(open(D+f'label{i}.json'))
    for ln in lines:
        j,e=ln.split('\t',1)
        v={k:c for k,c in m[e].items() if k not in('null',None)}
        rc=max(v,key=v.get);n=sum(v.values())
        rows.append((e,rc,lab[j],n))
toB={'슬레이트':'Y','혼합':'Y','비슬레이트':'N','코드만 슬레이트':'N','불명':'U'}
lb={'S':'Y','M':'Y','N':'N','U':'U'}
cnt=collections.Counter();mis=[]
for e,rc,l,n in rows:
    a,b=toB[rc],lb[l]
    if a!='U' and b!='U':
        cnt['both']+=1; cnt['agree' if a==b else 'dis']+=1
        if a!=b: mis.append((e,rc,l,n,'포함 여부 불일치'))
    else:
        if a!=b: mis.append((e,rc,l,n,'한쪽만 판정 보류'))
# 4-class
c4={'슬레이트':'S','혼합':'M','비슬레이트':'N','코드만 슬레이트':'N','불명':'U'}
a4=sum(1 for e,rc,l,n in rows if c4[rc]==l)
print('total',len(rows),'binary both decided',cnt['both'],'agree',cnt['agree'],'dis',cnt['dis'],'rate %.2f'%(100*cnt['agree']/cnt['both']),'4class agree %.1f'%(100*a4/len(rows)))
k=collections.Counter(x[4] for x in mis);print(k)
mis.sort(key=lambda x:(x[4]!='포함 여부 불일치',-x[3]))
with open('./온지붕_교차검증_불일치_검토표.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['구분','자유기재 원문','건물 수','사이트 판정(규칙표)','독립 판독(규칙표 미사용)','사람 검토 결과','메모'])
    L={'S':'슬레이트','M':'혼합','N':'비슬레이트','U':'판정 보류'}
    for e,rc,l,n,t in mis: w.writerow([t,e,n,rc,L[l],'',''])
for x in mis:
    if x[4]=='포함 여부 불일치': print(x[:4])
