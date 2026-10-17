// Source: user-provided stock Archer C20 lib.js (2026-10-15) — relevant lines only.
var ACT_GET = 1;
var ACT_GL = 5;
var ACT_CGI = 8;
function stockSerialize(obj) { data += "[" + obj[2] + "#" + obj[3] + "#" + obj[4] + "]" + index; }
// Preserve the literal CGI operation name with leading slash when provided.
function stockEncrypt(s) { if(s.data.match("/cgi/login") == null) return 0; else return 1; }
