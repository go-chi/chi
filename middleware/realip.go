package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"net"
	"net/http"
	"strings"
)

var trueClientIP = http.CanonicalHeaderKey("True-Client-IP")
var xForwardedFor = http.CanonicalHeaderKey("X-Forwarded-For")
var xRealIP = http.CanonicalHeaderKey("X-Real-IP")

// RealIP is a middleware that sets a http.Request's RemoteAddr to the results
// of parsing either the True-Client-IP, X-Real-IP or the X-Forwarded-For headers
// (in that order).
//
// Deprecated: RealIP is vulnerable to IP spoofing in any deployment where it
// can be reached by a client able to set these headers (see GHSA-3fxj-6jh8-hvhx,
// GHSA-rjr7-jggh-pgcp, GHSA-9g5q-2w5x-hmxf). It blindly takes the leftmost
// X-Forwarded-For value (trivially spoofable) and also trusts True-Client-IP
// and X-Real-IP whether or not your infrastructure actually sets them.
//
// Use one of [ClientIPFromHeader], [ClientIPFromXFF],
// [ClientIPFromXFFTrustedProxies] or [ClientIPFromRemoteAddr] instead — pick
// exactly one based on your network setup — and read the resulting IP with
// [GetClientIP] or [GetClientIPAddr]. Unlike RealIP, these never mutate
// r.RemoteAddr.
func RealIP(h http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		if rip := realIP(r); rip != "" {
			r.RemoteAddr = rip
		}
		h.ServeHTTP(w, r)
	}

	return http.HandlerFunc(fn)
}

func realIP(r *http.Request) string {
	var ip string

	if tcip := r.Header.Get(trueClientIP); tcip != "" {
		ip = tcip
	} else if xrip := r.Header.Get(xRealIP); xrip != "" {
		ip = xrip
	} else if xff := r.Header.Get(xForwardedFor); xff != "" {
		i := strings.Index(xff, ",")
		if i == -1 {
			i = len(xff)
		}
		ip = xff[:i]
	}
	if ip == "" || net.ParseIP(ip) == nil {
		return ""
	}
	return ip
}
