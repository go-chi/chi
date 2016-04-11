package middleware

import (
	"expvar"
	"fmt"
	"net/http"
	"net/http/pprof"
	"github.com/pressly/chi"
)

// Profiler is a convenient subrouter used for mounting net/http/pprof. ie.
//
// func MyService() http.Handler {
//   r := chi.NewRouter()
//   // ..middlewares
//   r.Mount("/debug", profiler.Router())
//   // ..routes
//   return r
// }
func Profiler() http.Handler {
	r := chi.NewRouter()
	r.Use(NoCache)

	r.Get("/", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.RequestURI+"/pprof/", 301)
	}))
	r.Handle("/pprof", chi.HFn(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.RequestURI+"/", 301)
	}))

	r.Handle("/pprof/", chi.HFn(pprof.Index))
	r.Handle("/pprof/cmdline", chi.HFn(pprof.Cmdline))
	r.Handle("/pprof/profile", chi.HFn(pprof.Profile))
	r.Handle("/pprof/symbol", chi.HFn(pprof.Symbol))
	r.Handle("/pprof/block", pprof.Handler("block"))
	r.Handle("/pprof/heap", pprof.Handler("heap"))
	r.Handle("/pprof/goroutine", pprof.Handler("goroutine"))
	r.Handle("/pprof/threadcreate", pprof.Handler("threadcreate"))
	r.Handle("/vars", chi.HFn(expVars))

	return r
}

// Replicated from expvar.go as not public.
func expVars(w http.ResponseWriter, r *http.Request) {
	first := true
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	fmt.Fprintf(w, "{\n")
	expvar.Do(func(kv expvar.KeyValue) {
		if !first {
			fmt.Fprintf(w, ",\n")
		}
		first = false
		fmt.Fprintf(w, "%q: %s", kv.Key, kv.Value)
	})
	fmt.Fprintf(w, "\n}\n")
}
