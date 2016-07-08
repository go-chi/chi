package middleware

import (
	"net/http"
	"testing"

	"github.com/pressly/chi"
)

type testLogAppender struct{}

func (l testLogAppender) Append(e LogEntry) {}

func BenchmarkLoggerWithoutMiddleware(b *testing.B) {

	r := chi.NewRouter()

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write(p)
	})

	req, err := http.NewRequest("GET", "/hi", nil)
	if err != nil {
		b.Fatalf("Unexpected error: %s", err)
	}

	w := &responseWriter{}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
	}

}

func BenchmarkLoggerWithOneAppender(b *testing.B) {

	r := chi.NewRouter()
	r.Use(NewLogger(&testLogAppender{}))

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write(p)
	})

	req, err := http.NewRequest("GET", "/hi", nil)
	if err != nil {
		b.Fatalf("Unexpected error: %s", err)
	}

	w := &responseWriter{}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
	}

}

func BenchmarkLoggerWithMultipleAppenders(b *testing.B) {

	r := chi.NewRouter()
	r.Use(NewLogger(
		&testLogAppender{}, &testLogAppender{}, &testLogAppender{},
		&testLogAppender{}, &testLogAppender{}, &testLogAppender{},
		&testLogAppender{}, &testLogAppender{}, &testLogAppender{},
	))

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		w.Write(p)
	})

	req, err := http.NewRequest("GET", "/hi", nil)
	if err != nil {
		b.Fatalf("Unexpected error: %s", err)
	}

	w := &responseWriter{}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
	}

}

func BenchmarkLoggerWithMultipleLayers(b *testing.B) {

	r := chi.NewRouter()

	p := []byte("hi")
	r.Route("/greetings", func(r chi.Router) {
		r.Route("/hi", func(r chi.Router) {
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				w.Write(p)
			})
		})
	})

	req, err := http.NewRequest("GET", "/greetings/hi", nil)
	if err != nil {
		b.Fatalf("Unexpected error: %s", err)
	}

	w := &responseWriter{}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
	}

}

func BenchmarkLoggerWithMultipleLayersAndAppenders(b *testing.B) {

	r := chi.NewRouter()
	r.Use(NewLogger(&testLogAppender{}, &testLogAppender{}))

	p := []byte("hi")
	r.Route("/greetings", func(r chi.Router) {

		r.Use(NewLogger(&testLogAppender{}, &testLogAppender{}))
		r.Route("/hi", func(r chi.Router) {

			r.Use(NewLogger(&testLogAppender{}, &testLogAppender{}))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				w.Write(p)
			})
		})

	})

	req, err := http.NewRequest("GET", "/greetings/hi", nil)
	if err != nil {
		b.Fatalf("Unexpected error: %s", err)
	}

	w := &responseWriter{}

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		r.ServeHTTP(w, req)
	}

}
