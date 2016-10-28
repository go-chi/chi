package middleware

// Ported from Goji's middleware, source:
// https://github.com/zenazn/goji/tree/master/web/middleware

import (
	"net/http"
)

// Recoverer is a middleware that recovers from panics, logs the panic (and a
// backtrace), and returns a HTTP 500 (Internal Server Error) status if
// possible.
//
// Recoverer prints a request ID if one is provided.
func Recoverer(next http.Handler) http.Handler {
	return FormattedRecoverer(defaultLogFormatter, next)
}

func FormattedRecoverer(f LogFormatter, next http.Handler) http.Handler {
	fn := func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				f.FormatLog(r, -1, -1, -1, err.(error))
				http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
			}
		}()

		next.ServeHTTP(w, r)
	}

	return http.HandlerFunc(fn)
}
