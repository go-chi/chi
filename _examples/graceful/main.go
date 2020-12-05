package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/go-chi/chi"
	"github.com/go-chi/chi/middleware"
	"github.com/go-chi/valve"
)

func main() {

	// Our graceful valve shut-off package to manage code preemption and
	// shutdown signaling.
	valv := valve.New()
	baseCtx := valv.Context()

	// Example of a long running background worker thing..
	go func(ctx context.Context) {
		for {
			<-time.After(1 * time.Second)

			func() {
				valve.Lever(ctx).Open()
				defer valve.Lever(ctx).Close()

				// actual code doing stuff..
				fmt.Println("tick..")
				time.Sleep(2 * time.Second)
				// end-logic

				// signal control..
				select {
				case <-valve.Lever(ctx).Stop():
					fmt.Println("valve is closed")
					return

				case <-ctx.Done():
					fmt.Println("context is cancelled, go home.")
					return
				default:
				}
			}()

		}
	}(baseCtx)

	// HTTP service running in this program as well. The valve context is set
	// as a base context on the server listener at the point where we instantiate
	// the server - look lower.
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)

	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("sup"))
	})

	r.Get("/slow", func(w http.ResponseWriter, r *http.Request) {

		valve.Lever(r.Context()).Open()
		defer valve.Lever(r.Context()).Close()

		select {
		case <-valve.Lever(r.Context()).Stop():
			fmt.Println("valve is closed. finish up..")

		case <-time.After(5 * time.Second):
			// The above channel simulates some hard work.
			// We want this handler to complete successfully during a shutdown signal,
			// so consider the work here as some background routine to fetch a long running
			// search query to find as many results as possible, but, instead we cut it short
			// and respond with what we have so far. How a shutdown is handled is entirely
			// up to the developer, as some code blocks are preemptable, and others are not.
			time.Sleep(5 * time.Second)
		}

		w.Write([]byte(fmt.Sprintf("all done.\n")))
	})

	srv := http.Server{Addr: ":3333", Handler: r}
	srv.BaseContext = func(_ net.Listener) context.Context {
		return baseCtx
	}

	c := make(chan os.Signal, 1)
	signal.Notify(c, os.Interrupt)
	go func() {
		for range c {
			// sig is a ^C, handle it
			fmt.Println("shutting down..")

			// first valv
			valv.Shutdown(20 * time.Second)

			// create context with timeout
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()

			// start http shutdown
			srv.Shutdown(ctx)

			// verify, in worst case call cancel via defer
			select {
			case <-time.After(21 * time.Second):
				fmt.Println("not all connections done")
			case <-ctx.Done():

			}
		}
	}()
	srv.ListenAndServe()
}
