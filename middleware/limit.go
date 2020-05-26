package middleware

import (
	"net"
	"net/http"
	"sync"

	"golang.org/x/time/rate"
)

// Limit allows requests up to rate r and permits bursts of at most b tokens.
func Limit(r, b int) func(next http.Handler) http.Handler {
	limiter := rate.NewLimiter(rate.Limit(r), b)
	return func(next http.Handler) http.Handler {
		fn := func(w http.ResponseWriter, r *http.Request) {
			if !limiter.Allow() {
				http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		}
		return http.HandlerFunc(fn)
	}
}

// LimitIP allows requests up to rate r and permits bursts of at most b tokens per IP.
func LimitIP(r, b int) func(next http.Handler) http.Handler {
	return newIpLimiter(r, b).Handler
}

type ipLimiter struct {
	limiters map[string]*rate.Limiter
	r        int // limiter rate
	b        int // limiter bucket size
	sync.RWMutex
}

func newIpLimiter(r, b int) *ipLimiter {
	return &ipLimiter{limiters: make(map[string]*rate.Limiter), r: r, b: b}
}

func (l *ipLimiter) getLimiter(key string) *rate.Limiter {
	l.RLock()
	ipLimiter, ok := l.limiters[key]
	l.RUnlock()
	if !ok {
		l.Lock()
		if ipLimiter, ok = l.limiters[key]; !ok {
			ipLimiter = rate.NewLimiter(rate.Limit(l.r), l.b)
			l.limiters[key] = ipLimiter
		}
		l.Unlock()
	}
	return ipLimiter
}

func (l *ipLimiter) Handler(next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		ipLimiter := l.getLimiter(ip)
		if !ipLimiter.Allow() {
			http.Error(w, http.StatusText(http.StatusTooManyRequests), http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	}
	return http.HandlerFunc(fn)
}
