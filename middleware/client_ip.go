package middleware

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// clientIPCtxKey stores the client IP set by any of the ClientIPFrom* middlewares.
var clientIPCtxKey = &contextKey{"clientIP"}

// xForwardedForHeader is the canonical form of the X-Forwarded-For header
// name, used by the XFF-based middlewares.
const xForwardedForHeader = "X-Forwarded-For"

// ClientIPFromHeader stores the client IP from a single-IP header set by
// your reverse proxy. Read it with [GetClientIP].
//
// Only safe with headers your proxy unconditionally OVERWRITES on every
// request, e.g.:
//
//   - X-Real-IP        — Nginx with ngx_http_realip_module
//   - X-Client-IP      — Apache with mod_remoteip
//   - CF-Connecting-IP — Cloudflare
//
// True-Client-IP, X-Azure-ClientIP, and Fastly-Client-IP look similar but
// pass through from the client by default in those products; don't use them
// unless your edge strips the inbound value.
//
// v4-mapped IPv6 (::ffff:a.b.c.d) folds to plain v4 and IPv6 zones are
// stripped before storage.
func ClientIPFromHeader(trustedHeader string) func(http.Handler) http.Handler {
	header := http.CanonicalHeaderKey(trustedHeader)
	return func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ip, ok := parseHeaderAddr(r.Header.Get(header)); ok {
				r = r.WithContext(context.WithValue(r.Context(), clientIPCtxKey, ip))
			}
			h.ServeHTTP(w, r)
		})
	}
}

// ClientIPFromXFF stores the client IP read from the X-Forwarded-For header,
// walking the chain right-to-left and skipping any IP that falls within one
// of the given trusted CIDR prefixes. The first IP that is not trusted is
// the client. Read it with [GetClientIP].
//
// Use this when you sit behind one or more reverse proxies whose IP ranges
// you can enumerate as CIDRs:
//
//	r.Use(middleware.ClientIPFromXFF(
//	    "13.32.0.0/15",   // CloudFront IPv4
//	    "52.46.0.0/18",   // CloudFront IPv4
//	    "2600:9000::/28", // CloudFront IPv6
//	))
//
// Calling with no arguments returns the rightmost parseable XFF IP — safe
// only if you have exactly one trusted hop directly in front of this server
// (e.g., nginx on localhost).
//
// v4-mapped IPv6 (::ffff:a.b.c.d) folds to plain v4 and IPv6 zones are
// stripped before the prefix check and storage; otherwise an attacker
// could use either notation to alias a trusted IP past the check.
//
// If you know the number of trusted proxies but not their IPs, use
// [ClientIPFromXFFTrustedProxies] instead.
//
// Panics at startup if any prefix is invalid.
func ClientIPFromXFF(trustedIPPrefixes ...string) func(http.Handler) http.Handler {
	prefixes := make([]netip.Prefix, len(trustedIPPrefixes))
	for i, p := range trustedIPPrefixes {
		prefixes[i] = netip.MustParsePrefix(p)
	}
	return func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if ip, ok := rightmostUntrustedXFF(r.Header.Values(xForwardedForHeader), prefixes); ok {
				r = r.WithContext(context.WithValue(r.Context(), clientIPCtxKey, ip))
			}
			h.ServeHTTP(w, r)
		})
	}
}

// ClientIPFromXFFTrustedProxies stores the client IP read from the
// X-Forwarded-For header, given the exact number of trusted reverse proxies
// between this server and the public internet. It returns the IP at position
// len(xff) - numTrustedProxies in the merged X-Forwarded-For list — the IP
// added by the outermost of your trusted proxies, the only IP in the chain
// that none of your proxies have allowed an attacker to forge. Read it with
// [GetClientIP].
//
// Use this when:
//   - You know exactly how many proxies you sit behind, AND
//   - Their IP addresses are dynamic (autoscaling proxy pools, ephemeral
//     containers, dynamic CDN edges) so listing CIDRs with [ClientIPFromXFF]
//     is impractical.
//
// WARNING: This variant is brittle to network architecture changes. If you
// add or remove a proxy level, numTrustedProxies silently becomes wrong and
// you may start trusting an attacker-supplied IP. Prefer [ClientIPFromXFF]
// with explicit trusted CIDRs whenever you can.
//
// If the XFF chain has fewer than numTrustedProxies entries (header missing
// or architecture changed), no client IP is set and [GetClientIP] returns "".
//
// Like [ClientIPFromXFF], v4-mapped IPv6 folds to plain v4 and IPv6 zones
// are stripped before storage.
//
// Panics at startup if numTrustedProxies < 1.
func ClientIPFromXFFTrustedProxies(numTrustedProxies int) func(http.Handler) http.Handler {
	if numTrustedProxies < 1 {
		panic("middleware.ClientIPFromXFFTrustedProxies: numTrustedProxies must be >= 1")
	}
	return func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			xff := mergeXFF(r.Header.Values(xForwardedForHeader))
			if i := len(xff) - numTrustedProxies; i >= 0 {
				if ip, ok := parseHeaderAddr(xff[i]); ok {
					r = r.WithContext(context.WithValue(r.Context(), clientIPCtxKey, ip))
				}
			}
			h.ServeHTTP(w, r)
		})
	}
}

// ClientIPFromRemoteAddr stores the client IP read from the TCP RemoteAddr
// of the incoming request — the IP address of whoever opened the connection
// to this server. Read it with [GetClientIP].
//
// Use this when this server is directly connected to the public internet
// with NO reverse proxy in front of it. Behind a reverse proxy, RemoteAddr
// is the proxy's IP, not the client's — use [ClientIPFromHeader] or
// [ClientIPFromXFF] instead.
//
// IPv4 clients on a dual-stack listener surface as ::ffff:a.b.c.d; they
// fold to plain v4 before storage so one logical client maps to one key.
// IPv6 zones are preserved (link-local connections may legitimately have one).
func ClientIPFromRemoteAddr(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			host = r.RemoteAddr // RemoteAddr may already be a bare IP (e.g. in tests).
		}
		if ip, err := netip.ParseAddr(host); err == nil {
			r = r.WithContext(context.WithValue(r.Context(), clientIPCtxKey, ip.Unmap()))
		}
		h.ServeHTTP(w, r)
	})
}

// GetClientIP returns the client IP as a string, as set by one of the
// ClientIPFrom* middlewares. Returns "" if no valid IP was set.
// Convenient for logging, rate-limit keys, etc.
func GetClientIP(ctx context.Context) string {
	ip := GetClientIPAddr(ctx)
	if !ip.IsValid() {
		return ""
	}
	return ip.String()
}

// GetClientIPAddr returns the client IP as a [netip.Addr], as set by one of
// the ClientIPFrom* middlewares. The returned Addr is the zero value if not
// set; use [netip.Addr.IsValid] to check. Useful when you need typed work —
// prefix containment, Is4/Is6, etc. — without re-parsing the string.
func GetClientIPAddr(ctx context.Context) netip.Addr {
	ip, _ := ctx.Value(clientIPCtxKey).(netip.Addr)
	return ip
}

// mergeXFF merges all X-Forwarded-For header values into a single ordered
// list of trimmed entries (left-to-right, in the order received). Empty
// entries are dropped. Entries are not validated as IPs here.
//
// Merging all instances is required for security: per RFC 2616, multiple
// XFF headers MUST be processed in order. Reading only the first or last
// header value lets an attacker pick which value security logic sees by
// sending duplicate headers.
func mergeXFF(headers []string) []string {
	out := make([]string, 0, len(headers))
	for _, h := range headers {
		for _, v := range strings.Split(h, ",") {
			if v = strings.TrimSpace(v); v != "" {
				out = append(out, v)
			}
		}
	}
	return out
}

// rightmostUntrustedXFF walks merged XFF right-to-left, skipping IPs that
// match trustedPrefixes (and unparseable entries), and returns the first
// remaining valid IP.
func rightmostUntrustedXFF(headers []string, trustedPrefixes []netip.Prefix) (netip.Addr, bool) {
	xff := mergeXFF(headers)
	for i := len(xff) - 1; i >= 0; i-- {
		ip, ok := parseHeaderAddr(xff[i])
		if !ok || inAnyPrefix(ip, trustedPrefixes) {
			continue
		}
		return ip, true
	}
	return netip.Addr{}, false
}

// inAnyPrefix reports whether ip falls within any of the given prefixes.
func inAnyPrefix(ip netip.Addr, prefixes []netip.Prefix) bool {
	for _, p := range prefixes {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// parseHeaderAddr parses s and normalizes for storage: v4-mapped IPv6
// (::ffff:a.b.c.d) folds to plain v4, IPv6 zone is stripped. Both defend the
// trust-prefix check against attacker-injected aliases — [netip.Prefix.Contains]
// returns false for v4-mapped addresses vs v4 prefixes and for any zoned
// address, so without folding/stripping an attacker could escape an
// otherwise valid trust list.
//
// Header-sourced IPs only. [ClientIPFromRemoteAddr] normalizes inline
// (Unmap, but zone preserved for legitimate link-local connections).
func parseHeaderAddr(s string) (netip.Addr, bool) {
	ip, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Addr{}, false
	}
	return ip.Unmap().WithZone(""), true
}
