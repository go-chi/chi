package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pressly/chi"
)

type benchLogAppender struct{}

func (l benchLogAppender) Append(e LogEntry) {}

func BenchmarkLoggerWithoutMiddleware(b *testing.B) {

	r := chi.NewRouter()

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write(p); err != nil {
			b.Fatalf("Unexpected error: %s", err)
		}
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
	r.Use(NewLogger(&benchLogAppender{}))

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write(p); err != nil {
			b.Fatalf("Unexpected error: %s", err)
		}
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
		&benchLogAppender{}, &benchLogAppender{}, &benchLogAppender{},
		&benchLogAppender{}, &benchLogAppender{}, &benchLogAppender{},
		&benchLogAppender{}, &benchLogAppender{}, &benchLogAppender{},
	))

	p := []byte("hi")
	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write(p); err != nil {
			b.Fatalf("Unexpected error: %s", err)
		}
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
				if _, err := w.Write(p); err != nil {
					b.Fatalf("Unexpected error: %s", err)
				}
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
	r.Use(NewLogger(&benchLogAppender{}, &benchLogAppender{}))

	p := []byte("hi")
	r.Route("/greetings", func(r chi.Router) {

		r.Use(NewLogger(&benchLogAppender{}, &benchLogAppender{}))
		r.Route("/hi", func(r chi.Router) {

			r.Use(NewLogger(&benchLogAppender{}, &benchLogAppender{}))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				if _, err := w.Write(p); err != nil {
					b.Fatalf("Unexpected error: %s", err)
				}
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

type testLogAppender struct {
	entry  LogEntry
	called bool
}

func (l *testLogAppender) Append(e LogEntry) {
	l.called = true
	l.entry = e
}

func TestLoggerWithoutAppender(t *testing.T) {

	r := chi.NewRouter()
	r.Use(NewLogger())

	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("hi")); err != nil {
			t.Fatalf("Unexpected error: %s", err)
		}
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	status, resp := testRequest(t, ts, "GET", "/hi", nil)

	if resp != "hi" {
		t.Fatalf("Response payload expected 'hi', received: %s", resp)
	}

	if status != 200 {
		t.Fatalf("Response status expected 200, received: %d", status)
	}

}

func TestLoggerWithNilAppenders(t *testing.T) {

	r := chi.NewRouter()
	r.Use(NewLogger(nil, nil))

	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("hi")); err != nil {
			t.Fatalf("Unexpected error: %s", err)
		}
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	status, resp := testRequest(t, ts, "GET", "/hi", nil)

	if resp != "hi" {
		t.Fatalf("Response payload expected 'hi', received: %s", resp)
	}

	if status != 200 {
		t.Fatalf("Response status expected 200, received: %d", status)
	}

}

func TestLoggerWithOneAppender(t *testing.T) {

	r := chi.NewRouter()
	l := &testLogAppender{}
	r.Use(NewLogger(l))

	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("hi")); err != nil {
			t.Fatalf("Unexpected error: %s", err)
		}
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	expectedMethod := "GET"
	expectedStatus := 200
	expectedURL := fmt.Sprintf("%s/hi", ts.URL)
	expectedResp := "hi"

	status, resp := testRequest(t, ts, "GET", "/hi", nil)

	checkLogAppender(t, l, status, expectedStatus, resp, expectedResp, expectedMethod, expectedURL)

}

func checkLogAppender(t *testing.T, l *testLogAppender, status, expectedStatus int,
	resp, expectedResp, expectedURL, expectedMethod string) {

	if resp != expectedResp {
		t.Fatalf("Response payload expected '%s', received: %s", expectedResp, resp)
	}

	if status != expectedStatus {
		t.Fatalf("Response status expected %d, received: %d", expectedStatus, status)
	}

	if !l.called {
		t.Fatal("LogEntry was not forwarded on LogAppender")
	}

	if l.entry.Status != expectedStatus {
		t.Fatalf("LogEntry status doesn't match with the response (%d): %d", expectedStatus, l.entry.Status)
	}

	if l.entry.Method != expectedMethod {
		t.Fatalf("LogEntry method doesn't match with the request (%s): %s", expectedMethod, l.entry.Method)
	}

	if l.entry.URL != expectedURL {
		t.Fatalf("LogEntry url doesn't match with the request (%s): %s", expectedURL, l.entry.URL)
	}

	if l.entry.RemoteAddr == "" {
		t.Fatal("A RemoteAddr was expected in LogEntry")
	}

	if l.entry.BytesWritten == 0 {
		t.Fatal("A BytesWritten was expected in LogEntry")
	}

	if l.entry.ExecutionTime == 0 {
		t.Fatal("A ExecutionTime was expected in LogEntry")
	}

}

func TestLoggerWithMultipleAppenders(t *testing.T) {

	r := chi.NewRouter()
	l1 := &testLogAppender{}
	l2 := &testLogAppender{}
	l3 := &testLogAppender{}
	r.Use(NewLogger(l1, l2, l3))

	r.Get("/hi", func(w http.ResponseWriter, r *http.Request) {
		if _, err := w.Write([]byte("hi")); err != nil {
			t.Fatalf("Unexpected error: %s", err)
		}
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	testRequest(t, ts, "GET", "/hi", nil)

	if !l1.called {
		t.Fatal("LogEntry was not forwarded on the first LogAppender")
	}

	if !l2.called {
		t.Fatal("LogEntry was not forwarded on the second LogAppender")
	}

	if !l3.called {
		t.Fatal("LogEntry was not forwarded on the third LogAppender")
	}

}

func TestLoggerWithMultipleLayers(t *testing.T) {

	r := chi.NewRouter()
	l1 := &testLogAppender{}
	l2 := &testLogAppender{}
	l3 := &testLogAppender{}

	r.Use(NewLogger(l1))
	r.Route("/greetings", func(r chi.Router) {

		r.Use(NewLogger(l2))
		r.Route("/hi", func(r chi.Router) {

			r.Use(NewLogger(l3))
			r.Get("/", func(w http.ResponseWriter, r *http.Request) {
				if _, err := w.Write([]byte("hi")); err != nil {
					t.Fatalf("Unexpected error: %s", err)
				}
			})
		})

		r.Get("/", func(w http.ResponseWriter, r *http.Request) {
			if _, err := w.Write([]byte("hi")); err != nil {
				t.Fatalf("Unexpected error: %s", err)
			}
		})

	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	var logTests = []struct {
		url    string
		l1call bool
		l2call bool
		l3call bool
	}{
		{"/hi", true, false, false},
		{"/greetings", true, true, false},
		{"/greetings/hi", true, true, true},
	}

	for _, tt := range logTests {

		testRequest(t, ts, "GET", tt.url, nil)

		if l1.called != tt.l1call {
			t.Fatalf("LogEntry forwarding behavior on the first LogAppender for %s doesn't match what was expected (%t): %t",
				tt.url, tt.l1call, l1.called)
		}

		if l2.called != tt.l2call {
			t.Fatalf("LogEntry forwarding behavior on the second LogAppender for %s doesn't match what was expected (%t): %t",
				tt.url, tt.l2call, l2.called)
		}

		if l3.called != tt.l3call {
			t.Fatalf("LogEntry forwarding behavior on the third LogAppender for %s doesn't match what was expected (%t): %t",
				tt.url, tt.l3call, l3.called)
		}

		l1.called = false
		l2.called = false
		l3.called = false

	}

}
