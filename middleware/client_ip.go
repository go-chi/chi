package middleware

import (
	"context"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

var (
	// clientIPCtxKey is the context key used to store the client IP address.
	clientIPCtxKey = &contextKey{"clientIP"}
)

// ClientIPFromHeader parses the client IP address from a specified HTTP header
// (e.g., X-Real-IP, CF-Connecting-IP) and injects it into the request context
// if it is not already set. The parsed IP address can be retrieved using GetClientIP().
//
// The middleware validates the IP address to ignore loopback, private, and unspecified addresses.
//
// ### Important Notice:
// - Use this middleware only when your infrastructure sets a trusted header containing the client IP.
// - If the specified header is not securely set by your infrastructure, malicious clients could spoof it.
//
// Example trusted headers:
// - "X-Real-IP"        - Nginx (ngx_http_realip_module)
// - "X-Client-IP"      - Apache (mod_remoteip)
// - "CF-Connecting-IP" - Cloudflare
// - "True-Client-IP"   - Akamai, Cloudflare Enterprise
// - "X-Azure-ClientIP" - Azure Front Door
// - "Fastly-Client-IP" - Fastly
func ClientIPFromHeader(trustedHeader string) func(http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			// Check if the client IP is already set in the context.
			if _, ok := ctx.Value(clientIPCtxKey).(netip.Addr); ok {
				h.ServeHTTP(w, r)
				return
			}

			// Parse the IP address from the trusted header.
			ip, err := netip.ParseAddr(r.Header.Get(trustedHeader))
			if err != nil || ip.IsLoopback() || ip.IsUnspecified() || ip.IsPrivate() {
				// Ignore invalid or private IPs.
				h.ServeHTTP(w, r)
				return
			}

			// Store the valid client IP in the context.
			ctx = context.WithValue(ctx, clientIPCtxKey, ip)
			h.ServeHTTP(w, r.WithContext(ctx))
		}
		return http.HandlerFunc(fn)
	}
}

// ClientIPFromXFFHeader parses the client IP address from the X-Forwarded-For
// header and injects it into the request context if it is not already set. The
// parsed IP address can be retrieved using GetClientIP().
//
// The middleware traverses the X-Forwarded-For chain (rightmost untrusted IP)
// and excludes loopback, private, unspecified, and trusted IP ranges.
//
// ### Important Notice:
// - Use this middleware only when your infrastructure sets and validates the X-Forwarded-For header.
// - Malicious clients can spoof the header unless a trusted reverse proxy or load balancer sanitizes it.
//
// Parameters:
// - `trustedIPPrefixes`: A list of CIDR prefixes that define trusted proxy IP ranges.
//
// Example trusted IP ranges:
// - "203.0.113.0/24"     - Example corporate proxy
// - "198.51.100.0/24"    - Example data center or hosting provider
// - "2400:cb00::/32"     - Cloudflare IPv6 range
// - "2606:4700::/32"     - Cloudflare IPv6 range
// - "192.0.2.0/24"       - Example VPN gateway
//
// Note: Private IP ranges (e.g., "10.0.0.0/8", "192.168.0.0/16", "172.16.0.0/12")
// are automatically excluded by netip.Addr.IsPrivate() and do not need to be added here.
func ClientIPFromXFFHeader(trustedIPPrefixes ...string) func(http.Handler) http.Handler {
	// Pre-parse trusted prefixes.
	trustedPrefixes := make([]netip.Prefix, len(trustedIPPrefixes))
	for i, ipRange := range trustedIPPrefixes {
		trustedPrefixes[i] = netip.MustParsePrefix(ipRange)
	}

	return func(h http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			// Check if the client IP is already set in the context.
			if _, ok := ctx.Value(clientIPCtxKey).(netip.Addr); ok {
				h.ServeHTTP(w, r)
				return
			}

			// Parse and split the X-Forwarded-For header(s).
			xff := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		nextValue:
			for i := len(xff) - 1; i >= 0; i-- {
				ip, err := netip.ParseAddr(strings.TrimSpace(xff[i]))
				if err != nil {
					continue
				}

				// Ignore loopback, private, or unspecified addresses.
				if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() {
					continue
				}

				// Ignore trusted IPs within the given ranges.
				for _, prefix := range trustedPrefixes {
					if prefix.Contains(ip) {
						continue nextValue
					}
				}

				// Store the valid client IP in the context.
				ctx = context.WithValue(ctx, clientIPCtxKey, ip)
				h.ServeHTTP(w, r.WithContext(ctx))
				return
			}

			h.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

// ClientIPFromRemoteAddr extracts the client IP address from the RemoteAddr
// field of the HTTP request and injects it into the request context if it is
// not already set. The parsed IP address can be retrieved using GetClientIP().
//
// The middleware ignores invalid or private IPs.
//
// ### Use Case:
// This middleware is useful when the client IP cannot be determined from headers
// such as X-Forwarded-For or X-Real-IP, and you need to fall back to RemoteAddr.
func ClientIPFromRemoteAddr(h http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Check if the client IP is already set in the context.
		if _, ok := ctx.Value(clientIPCtxKey).(netip.Addr); ok {
			h.ServeHTTP(w, r)
			return
		}

		// Extract the IP from request RemoteAddr.
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			h.ServeHTTP(w, r)
			return
		}

		ip, err := netip.ParseAddr(host)
		if err != nil {
			h.ServeHTTP(w, r)
			return
		}

		// Store the valid client IP in the context.
		ctx = context.WithValue(ctx, clientIPCtxKey, ip)
		h.ServeHTTP(w, r.WithContext(ctx))
	}
	return http.HandlerFunc(fn)
}

// GetClientIP retrieves the client IP address from the given context.
// The IP address is set by one of the following middlewares:
// - ClientIPFromHeader
// - ClientIPFromXFFHeader
// - ClientIPFromRemoteAddr
//
// Returns an empty string if no valid IP is found.
func GetClientIP(ctx context.Context) string {
	ip, ok := ctx.Value(clientIPCtxKey).(netip.Addr)
	if !ok || !ip.IsValid() {
		return ""
	}
	return ip.String()
}
