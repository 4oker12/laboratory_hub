#!/usr/bin/env python3
"""RouterLab Archer C20 V5 stock image inspection, no flashing or router access."""
import hashlib, json, pathlib, re, sys, urllib.request, zipfile, io

targets = {
 "RU": ("Archer C20(RU)_V5_260615", "https://www.tp-link.com/kz/support/download/archer-c20/v5/", [
  "https://static.tp-link.com/upload/firmware/2026/202606/20260616/Archer%20C20(RU)_V5_260615.zip"]),
 "EU": ("Archer C20(EU)_V5_260317", "https://www.tp-link.com/uk-ua/support/download/archer-c20/v5/", [
  "https://static.tp-link.com/upload/firmware/2026/202604/20260409/Archer%20C20(EU)_V5_260317.zip",
  "https://static.tp-link.com/upload/firmware/2026/202604/20260410/Archer%20C20(EU)_V5_260317.zip",
  "https://static.tp-link.com/upload/firmware/2026/202603/20260317/Archer%20C20(EU)_V5_260317.zip"])
}
def sha(b): return hashlib.sha256(b).hexdigest()
def fetch(url, cap=25000000):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 RouterLab-stock-evidence"})
 with urllib.request.urlopen(req,timeout=35) as r:
  b=r.read(cap+1)
  if len(b)>cap: raise ValueError("response exceeds byte cap")
  return b,r.url
def inspect(b):
 sigs={key:[m.start() for m in list(re.finditer(re.escape(magic),b))[:8]] for key,magic in [
  ("squashfs_le",b"hsqs"),("squashfs_be",b"sqsh"),("uimage",bytes.fromhex("27051956"))]}
 return {"bytes":len(b),"sha256":sha(b),"first_96_bytes":b[:96].hex(),"signature_offsets":sigs}
out=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else "/tmp/routerlab-c20-stock")
out.mkdir(parents=True,exist_ok=True)
report={"scope":"STATIC_ONLY","physical_device_region":"NOT_VERIFIED","variants":{}}
for region,(release,support,candidates) in targets.items():
 rec={"release":release,"vendor_listing":support,"attempts":[]}
 try:
  html,_=fetch(support,3000000)
  txt=html.decode("utf8","replace").replace("\\/","/")
  rec["listed_on_vendor_page"]=release.lower() in txt.lower()
  found=re.findall(r"https?://[^\s\"<>]+?\.zip",txt,re.I)
  candidates=[x.replace("&amp;","&") for x in found if "C20" in x.upper() and "V5" in x.upper() and release[-6:] in x]+candidates
 except Exception as e: rec["listing_fetch_error"]=str(e)[:120]
 for url in dict.fromkeys(candidates):
  if len(rec["attempts"])>=12: break
  try:
   blob,resolved=fetch(url)
   if not zipfile.is_zipfile(io.BytesIO(blob)): raise ValueError("NOT_A_ZIP")
   with zipfile.ZipFile(io.BytesIO(blob)) as z:
    members=[x for x in z.infolist() if x.filename.lower().endswith(".bin") and 2000000<x.file_size<16000000]
    if not members: raise ValueError("ZIP_HAS_NO_FIRMWARE_BIN")
    rec["images"]={x.filename:inspect(z.read(x)) for x in members}
   rec["download"]={"url":resolved,"bytes":len(blob),"sha256":sha(blob)}
   rec["status"]="ACQUIRED_AND_STATIC_INSPECTED"
   break
  except Exception as e: rec["attempts"].append({"url":url,"error":str(e)[:140]})
 if "status" not in rec: rec["status"]="NOT_DOWNLOADED"
 report["variants"][region]=rec
 print(region,rec["status"],flush=True)
(out/"REPORT.json").write_text(json.dumps(report,indent=2,ensure_ascii=False))
lines=["# C20 V5 firmware provenance","","> STATIC ONLY: no firmware installed; physical ISP/RU/EU identity unverified.",""]
for region,rec in report["variants"].items():
 lines+=["## "+region+" "+rec["release"],"","- Status: "+rec["status"],"- Vendor: "+rec["vendor_listing"]]
 if "download" in rec:
  lines+=["- ZIP SHA-256: "+rec["download"]["sha256"],"- Source: "+rec["download"]["url"]]
  for name,d in rec["images"].items():
   lines+=["- BIN: "+name,"- BIN SHA-256: "+d["sha256"],"- SquashFS offsets: "+str(d["signature_offsets"].get("squashfs_le"))]
 lines+=[""]
lines+=["## Do not flash","", "Confirm sticker model and vendor region/ISP variant, product ID, firmware image header, backup, and recovery procedure. A generic EU/RU image may not be accepted by an ISP build.",""]
(out/"REPORT.md").write_text("\n".join(lines))
if not any(r["status"]=="ACQUIRED_AND_STATIC_INSPECTED" for r in report["variants"].values()):
 sys.exit("No valid vendor archive acquired; inspect REPORT.json")
