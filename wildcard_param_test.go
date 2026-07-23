package chi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// Named catch-all {name:*} (issue #1106) matches path segments (including
// slashes) under a user-chosen param key. It may be terminal or mid-route
// with a static suffix.
func TestNamedCatchAllParam(t *testing.T) {
	r := NewRouter()
	r.Get("/files/{path:*}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "path")))
	})
	r.Get("/assets/{id}/{rest:*}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "id") + "|" + URLParam(r, "rest")))
	})
	// Existing bare * still works and records key "*".
	r.Get("/legacy/*", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(URLParam(r, "*")))
	})

	tests := []struct {
		path string
		want string
	}{
		{"/files/", ""},
		{"/files/a", "a"},
		{"/files/a/b/c", "a/b/c"},
		{"/files/foo/bar.txt", "foo/bar.txt"},
		{"/assets/9/x/y", "9|x/y"},
		{"/legacy/z/w", "z/w"},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d", tc.path, rec.Code)
		}
		if got := rec.Body.String(); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.path, got, tc.want)
		}
	}
}

// Mid-route named catch-all: /files/{path:*}/edit etc. (issue #1106).
func TestNamedCatchAllMidRoute(t *testing.T) {
	r := NewRouter()
	r.Get("/files/{path:*}/edit", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("edit:" + URLParam(r, "path")))
	})
	r.Delete("/files/{path:*}/delete", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("delete:" + URLParam(r, "path")))
	})
	r.Post("/files/{path:*}/upload", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("upload:" + URLParam(r, "path")))
	})
	// Terminal catch-all coexists and is less specific than /edit.
	r.Get("/files/{path:*}", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("get:" + URLParam(r, "path")))
	})

	tests := []struct {
		method string
		path   string
		want   string
		code   int
	}{
		{http.MethodGet, "/files/one/two/three/four/edit", "edit:one/two/three/four", 200},
		{http.MethodGet, "/files/foo/bar.txt/edit", "edit:foo/bar.txt", 200},
		{http.MethodDelete, "/files/a/b/delete", "delete:a/b", 200},
		// Empty path value: /files/upload → path=""
		{http.MethodPost, "/files/upload", "upload:", 200},
		// Terminal catch-all when no static suffix matches
		{http.MethodGet, "/files/a/b/c", "get:a/b/c", 200},
		// More specific /edit wins over terminal catch-all
		{http.MethodGet, "/files/x/edit", "edit:x", 200},
		// Unknown suffix
		{http.MethodGet, "/files/a/b/unknown", "get:a/b/unknown", 200},
		// Method not registered on mid-route leaf
		{http.MethodGet, "/files/a/delete", "get:a/delete", 200},
	}
	for _, tc := range tests {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != tc.code {
			t.Fatalf("%s %s: status %d want %d body=%q", tc.method, tc.path, rec.Code, tc.code, rec.Body.String())
		}
		if tc.code == 200 {
			if got := rec.Body.String(); got != tc.want {
				t.Fatalf("%s %s: got %q want %q", tc.method, tc.path, got, tc.want)
			}
		}
	}
}

func TestBareWildcardMustStillBeLast(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for trailing text after bare *")
		}
	}()
	r := NewRouter()
	r.Get("/files/*/edit", func(w http.ResponseWriter, r *http.Request) {})
}

func TestNamedCatchAllEmptyNamePanics(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic for empty named catch-all key")
		}
	}()
	r := NewRouter()
	r.Get("/files/{:*}", func(w http.ResponseWriter, r *http.Request) {})
}

func TestPatNextSegmentNamedCatchAll(t *testing.T) {
	nt, key, rex, _, _, pe := patNextSegment("/files/{path:*}")
	if nt != ntCatchAll || key != "path" || rex != "" {
		t.Fatalf("got typ=%v key=%q rex=%q", nt, key, rex)
	}
	_ = pe

	// Mid-route: segment ends after }, remaining pattern is /edit
	nt, key, _, _, ps, pe := patNextSegment("{path:*}/edit")
	if nt != ntCatchAll || key != "path" || ps != 0 || pe != len("{path:*}") {
		t.Fatalf("mid-route: typ=%v key=%q ps=%d pe=%d", nt, key, ps, pe)
	}

	keys := patParamKeys("/files/{path:*}")
	if len(keys) != 1 || keys[0] != "path" {
		t.Fatalf("keys=%v", keys)
	}
	keys = patParamKeys("/a/{id}/{rest:*}")
	if len(keys) != 2 || keys[0] != "id" || keys[1] != "rest" {
		t.Fatalf("keys=%v", keys)
	}
	keys = patParamKeys("/files/{path:*}/edit")
	if len(keys) != 1 || keys[0] != "path" {
		t.Fatalf("mid-route keys=%v", keys)
	}
}
