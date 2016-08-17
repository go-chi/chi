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
//  func MyService() http.Handler {
//    r := chi.NewRouter()
//    // ..middlewares
//    r.Mount("/debug", profiler.Router())
//    // ..routes
//    return r
//  }
func Profiler() http.Handler {
	r := chi.NewRouter()
	r.Use(NoCache)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.RequestURI+"/pprof/", 301)
	})
	r.Any("/pprof", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, r.RequestURI+"/", 301)
	})

	r.HandleFunc(chi.ANY, "/pprof/", pprof.Index)
	r.HandleFunc(chi.ANY, "/pprof/cmdline", pprof.Cmdline)
	r.HandleFunc(chi.ANY, "/pprof/profile", pprof.Profile)
	r.HandleFunc(chi.ANY, "/pprof/symbol", pprof.Symbol)
	r.Handle(chi.ANY, "/pprof/block", pprof.Handler("block"))
	r.Handle(chi.ANY, "/pprof/heap", pprof.Handler("heap"))
	r.Handle(chi.ANY, "/pprof/goroutine", pprof.Handler("goroutine"))
	r.Handle(chi.ANY, "/pprof/threadcreate", pprof.Handler("threadcreate"))
	r.HandleFunc(chi.ANY, "/vars", expVars)

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
