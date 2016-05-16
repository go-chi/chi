package chi

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"golang.org/x/net/context"
)

func TestMuxServeHTTPC(t *testing.T) {
	r := NewRouter()
	r.Get("/hi", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		s, _ := ctx.Value("testCtx").(string)
		w.Write([]byte(s))
	})
	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		s, _ := ctx.Value("testCtx").(string)
		w.WriteHeader(404)
		w.Write([]byte(s))
	})

	// Thanks to https://github.com/mrcpvn for the clean table test submission
	testcases := []struct {
		Method         string
		Path           string
		Ctx            context.Context
		ExpectedStatus int
		ExpectedBody   string
	}{
		{
			Method:         "GET",
			Path:           "/hi",
			Ctx:            context.WithValue(context.Background(), "testCtx", "hi ctx"),
			ExpectedStatus: 200,
			ExpectedBody:   "hi ctx",
		},
		{
			Method:         "GET",
			Path:           "/hello",
			Ctx:            context.WithValue(context.Background(), "testCtx", "nothing here ctx"),
			ExpectedStatus: 404,
			ExpectedBody:   "nothing here ctx",
		},
	}

	for _, tc := range testcases {
		resp := httptest.NewRecorder()
		req, err := http.NewRequest(tc.Method, tc.Path, nil)
		if err != nil {
			t.Fatalf("%v", err)
		}
		r.ServeHTTPC(tc.Ctx, resp, req)
		b, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			t.Fatalf("%v", err)
		}
		if resp.Code != tc.ExpectedStatus {
			t.Fatalf("%v != %v", tc.ExpectedStatus, resp.Code)
		}
		if string(b) != tc.ExpectedBody {
			t.Fatalf("%s != %s", tc.ExpectedBody, b)
		}
	}
}

func TestMux(t *testing.T) {
	var count uint64
	countermw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			count++
			next.ServeHTTP(w, r)
		})
	}

	usermw := func(next Handler) Handler {
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx = context.WithValue(ctx, "user", "peter")
			next.ServeHTTPC(ctx, w, r)
		})
	}

	exmw := func(next Handler) Handler {
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx = context.WithValue(ctx, "ex", "a")
			next.ServeHTTPC(ctx, w, r)
		})
	}
	_ = exmw

	logbuf := bytes.NewBufferString("")
	logmsg := "logmw test"
	logmw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			logbuf.WriteString(logmsg)
			next.ServeHTTP(w, r)
		})
	}
	_ = logmw

	cxindex := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		user := ctx.Value("user").(string)
		w.WriteHeader(200)
		w.Write([]byte(fmt.Sprintf("hi %s", user)))
	}

	ping := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("."))
	}

	headPing := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Ping", "1")
		w.WriteHeader(200)
	}

	createPing := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		// create ....
		w.WriteHeader(201)
	}

	pingAll := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ping all"))
	}
	_ = pingAll

	pingAll2 := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("ping all2"))
	}
	_ = pingAll2

	pingOne := func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		idParam := URLParam(ctx, "id")

		w.WriteHeader(200)
		w.Write([]byte(fmt.Sprintf("ping one id: %s", idParam)))
	}

	pingWoop := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("woop."))
	}
	_ = pingWoop

	catchAll := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.Write([]byte("catchall"))
	}
	_ = catchAll

	m := NewRouter()
	m.Use(countermw)
	m.Use(usermw)
	m.Use(exmw)
	m.Use(logmw)
	m.Get("/", cxindex)
	m.Get("/ping", ping)
	m.Get("/pingall", pingAll) // .. TODO: pingAll, case-sensitivity .. etc....?
	m.Get("/ping/all", pingAll)
	m.Get("/ping/all2", pingAll2)

	m.Head("/ping", headPing)
	m.Post("/ping", createPing)
	m.Get("/ping/:id", pingOne)
	m.Get("/ping/:id", pingOne) // should overwrite.. and just be 1
	m.Get("/ping/:id/woop", pingWoop)
	m.Handle("/admin/*", catchAll)
	// m.Post("/admin/*", catchAll)

	ts := httptest.NewServer(m)
	defer ts.Close()

	// GET /
	if resp := testRequest(t, ts, "GET", "/", nil); resp != "hi peter" {
		t.Fatalf(resp)
	}
	tlogmsg, _ := logbuf.ReadString(0)
	if tlogmsg != logmsg {
		t.Error("expecting log message from middlware:", logmsg)
	}

	// GET /ping
	if resp := testRequest(t, ts, "GET", "/ping", nil); resp != "." {
		t.Fatalf(resp)
	}

	// GET /pingall
	if resp := testRequest(t, ts, "GET", "/pingall", nil); resp != "ping all" {
		t.Fatalf(resp)
	}

	// GET /ping/all
	if resp := testRequest(t, ts, "GET", "/ping/all", nil); resp != "ping all" {
		t.Fatalf(resp)
	}

	// GET /ping/all2
	if resp := testRequest(t, ts, "GET", "/ping/all2", nil); resp != "ping all2" {
		t.Fatalf(resp)
	}

	// GET /ping/123
	if resp := testRequest(t, ts, "GET", "/ping/123", nil); resp != "ping one id: 123" {
		t.Fatalf(resp)
	}

	// GET /ping/allan
	if resp := testRequest(t, ts, "GET", "/ping/allan", nil); resp != "ping one id: allan" {
		t.Fatalf(resp)
	}

	// GET /ping/1/woop
	if resp := testRequest(t, ts, "GET", "/ping/1/woop", nil); resp != "woop." {
		t.Fatalf(resp)
	}

	// HEAD /ping
	resp, err := http.Head(ts.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != 200 {
		t.Error("head failed, should be 200")
	}
	if resp.Header.Get("X-Ping") == "" {
		t.Error("expecting X-Ping header")
	}

	// GET /admin/catch-this
	if resp := testRequest(t, ts, "GET", "/admin/catch-thazzzzz", nil); resp != "catchall" {
		t.Fatalf(resp)
	}

	// POST /admin/catch-this
	resp, err = http.Post(ts.URL+"/admin/casdfsadfs", "text/plain", bytes.NewReader([]byte{}))
	if err != nil {
		t.Fatal(err)
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Error("POST failed, should be 200")
	}

	if string(body) != "catchall" {
		t.Error("expecting response body: 'catchall'")
	}

	// Custom http method DIE /ping/1/woop
	if resp := testRequest(t, ts, "DIE", "/ping/1/woop", nil); resp != "Method Not Allowed" {
		t.Fatalf(resp)
	}
}

func TestMuxPlain(t *testing.T) {
	r := NewRouter()
	r.Get("/hi", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("bye"))
	})
	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	if resp := testRequest(t, ts, "GET", "/hi", nil); resp != "bye" {
		t.Fatalf(resp)
	}
	if resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp != "nothing here" {
		t.Fatalf(resp)
	}
}

func TestMuxNestedNotFound(t *testing.T) {
	r := NewRouter()
	r.Get("/hi", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("bye"))
	})
	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("root 404"))
	})

	sr1 := NewRouter()
	sr1.Get("/sub", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("sub"))
	})
	sr1.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("sub 404"))
	})

	sr2 := NewRouter()
	sr2.Get("/sub", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("sub2"))
	})

	r.Mount("/admin1", sr1)
	r.Mount("/admin2", sr2)

	ts := httptest.NewServer(r)
	defer ts.Close()

	if resp := testRequest(t, ts, "GET", "/hi", nil); resp != "bye" {
		t.Fatalf(resp)
	}
	if resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp != "root 404" {
		t.Fatalf(resp)
	}
	if resp := testRequest(t, ts, "GET", "/admin1/sub", nil); resp != "sub" {
		t.Fatalf(resp)
	}
	if resp := testRequest(t, ts, "GET", "/admin1/nope", nil); resp != "sub 404" {
		t.Fatalf(resp)
	}
	if resp := testRequest(t, ts, "GET", "/admin2/sub", nil); resp != "sub2" {
		t.Fatalf(resp)
	}

	// Not found pages should bubble up to the root.
	if resp := testRequest(t, ts, "GET", "/admin2/nope", nil); resp != "root 404" {
		t.Fatalf(resp)
	}

}

func TestMuxMiddlewareStack(t *testing.T) {
	var stdmwInit, stdmwHandler uint64
	stdmw := func(next http.Handler) http.Handler {
		stdmwInit++
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			stdmwHandler++
			next.ServeHTTP(w, r)
		})
	}
	_ = stdmw

	var ctxmwInit, ctxmwHandler uint64
	ctxmw := func(next Handler) Handler {
		ctxmwInit++
		// log.Println("INIT")
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctxmwHandler++
			ctx = context.WithValue(ctx, "count.ctxmwHandler", ctxmwHandler)
			next.ServeHTTPC(ctx, w, r)
		})
	}

	var inCtxmwInit, inCtxmwHandler uint64
	inCtxmw := func(next Handler) Handler {
		inCtxmwInit++
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			inCtxmwHandler++
			next.ServeHTTPC(ctx, w, r)
		})
	}

	r := NewRouter()
	r.Use(stdmw)
	r.Use(ctxmw)
	r.Use(func(next http.Handler) http.Handler {
		// log.Println("std, inline mw init")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			next.ServeHTTP(w, r)
		})
	})
	// r.Use(func(next http.Handler) http.Handler {
	// 	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	// 		next.ServeHTTP(w, r)
	// 	})
	// })
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/ping" {
				w.Write([]byte("pong"))
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	var handlerCount uint64
	r.Get("/", inCtxmw, func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		handlerCount++
		ctxmwHandlerCount := ctx.Value("count.ctxmwHandler").(uint64)
		w.Write([]byte(fmt.Sprintf("inits:%d reqs:%d ctxValue:%d", ctxmwInit, handlerCount, ctxmwHandlerCount)))
	})

	r.Get("/hi", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("wooot"))
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	// log.Println("routes set.")

	var resp string
	resp = testRequest(t, ts, "GET", "/", nil)
	resp = testRequest(t, ts, "GET", "/", nil)
	resp = testRequest(t, ts, "GET", "/", nil)
	if resp != "inits:1 reqs:3 ctxValue:3" {
		t.Fatalf("got: '%s'", resp)
	}

	resp = testRequest(t, ts, "GET", "/ping", nil)
	if resp != "pong" {
		t.Fatalf("got: '%s'", resp)
	}
}

func TestMuxRootGroup(t *testing.T) {
	var stdmwInit, stdmwHandler uint64
	stdmw := func(next http.Handler) http.Handler {
		stdmwInit++
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// log.Println("$$$$$ stdmw handlerfunc here!")
			stdmwHandler++
			next.ServeHTTP(w, r)
		})
	}
	// stdmw := func(next Handler) Handler {
	// 	stdmwInit++
	// 	return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// 		log.Println("$$$$$ stdmw handlerfunc here!")
	// 		stdmwHandler++
	// 		next.ServeHTTPC(ctx, w, r)
	// 	})
	// }

	r := NewRouter()
	// r.Use(func(next Handler) Handler {
	// 	return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
	// 		next.ServeHTTPC(ctx, w, r)
	// 	})
	// })
	r.Group(func(r Router) {
		r.Use(stdmw)
		r.Get("/group", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("root group"))
		})
	})

	ts := httptest.NewServer(r)
	defer ts.Close()

	// GET /group
	resp := testRequest(t, ts, "GET", "/group", nil)
	if resp != "root group" {
		t.Fatalf("got: '%s'", resp)
	}
	if stdmwInit != 1 || stdmwHandler != 1 {
		t.Fatalf("stdmw counters failed, should be 1:1, got %d:%d", stdmwInit, stdmwHandler)
	}
}

func TestMuxBig(t *testing.T) {
	var r, sr1, sr2, sr3, sr4, sr5, sr6 *Mux
	r = NewRouter()
	r.Use(func(next Handler) Handler {
		return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			ctx = context.WithValue(ctx, "requestID", "1")
			next.ServeHTTPC(ctx, w, r)
		})
	})
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// log.Println("request:", r.URL.Path) // TODO: put in buffer..
			next.ServeHTTP(w, r)
		})
	})
	r.Group(func(r Router) {
		r.Use(func(next Handler) Handler {
			return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
				next.ServeHTTPC(ctx, w, r)
			})
		})
		r.Get("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
			w.Write([]byte("fav"))
		})
		r.Get("/hubs/:hubID/view", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/hubs/%s/view reqid:%s", URLParam(ctx, "hubID"), ctx.Value("requestID"))
			w.Write([]byte(s))
		})
		r.Get("/hubs/:hubID/view/*", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/hubs/%s/view/%s reqid:%s", URLParam(ctx, "hubID"), URLParam(ctx, "*"),
				ctx.Value("requestID"))
			w.Write([]byte(s))
		})
	})
	r.Group(func(r Router) {
		r.Use(func(next Handler) Handler {
			return HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
				ctx = context.WithValue(ctx, "session.user", "elvis")
				next.ServeHTTPC(ctx, w, r)
			})
		})
		r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/ reqid:%s session:%s", ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})
		r.Get("/suggestions", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/suggestions reqid:%s session:%s", ctx.Value("requestID"), ctx.Value("session.user"))
			w.Write([]byte(s))
		})

		r.Get("/woot/:wootID/*", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
			s := fmt.Sprintf("/woot/%s/%s", URLParam(ctx, "wootID"), URLParam(ctx, "*"))
			w.Write([]byte(s))
		})

		r.Route("/hubs", func(r Router) {
			sr1 = r.(*Mux)
			r.Route("/:hubID", func(r Router) {
				sr2 = r.(*Mux)
				r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
					s := fmt.Sprintf("/hubs/%s reqid:%s session:%s",
						URLParam(ctx, "hubID"), ctx.Value("requestID"), ctx.Value("session.user"))
					w.Write([]byte(s))
				})
				r.Get("/touch", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
					s := fmt.Sprintf("/hubs/%s/touch reqid:%s session:%s", URLParam(ctx, "hubID"),
						ctx.Value("requestID"), ctx.Value("session.user"))
					w.Write([]byte(s))
				})

				sr3 = NewRouter()
				sr3.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
					s := fmt.Sprintf("/hubs/%s/webhooks reqid:%s session:%s", URLParam(ctx, "hubID"),
						ctx.Value("requestID"), ctx.Value("session.user"))
					w.Write([]byte(s))
				})
				sr3.Route("/:webhookID", func(r Router) {
					sr4 = r.(*Mux)
					r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
						s := fmt.Sprintf("/hubs/%s/webhooks/%s reqid:%s session:%s", URLParam(ctx, "hubID"),
							URLParam(ctx, "webhookID"), ctx.Value("requestID"), ctx.Value("session.user"))
						w.Write([]byte(s))
					})
				})
				r.Mount("/webhooks", sr3)

				r.Route("/posts", func(r Router) {
					sr5 = r.(*Mux)
					r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
						s := fmt.Sprintf("/hubs/%s/posts reqid:%s session:%s", URLParam(ctx, "hubID"),
							ctx.Value("requestID"), ctx.Value("session.user"))
						w.Write([]byte(s))
					})
				})
			})
		})

		r.Route("/folders/", func(r Router) {
			sr6 = r.(*Mux)
			r.Get("/", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
				s := fmt.Sprintf("/folders/ reqid:%s session:%s",
					ctx.Value("requestID"), ctx.Value("session.user"))
				w.Write([]byte(s))
			})
			r.Get("/public", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
				s := fmt.Sprintf("/folders/public reqid:%s session:%s",
					ctx.Value("requestID"), ctx.Value("session.user"))
				w.Write([]byte(s))
			})
		})
	})

	// log.Println("")
	// log.Println("~~router")
	// debugPrintTree(0, 0, r.router[mGET].root, 0)
	// log.Println("")
	// log.Println("")
	//
	// log.Println("~~subrouter1")
	// debugPrintTree(0, 0, sr1.router[mGET].root, 0)
	// log.Println("")
	//
	// log.Println("~~subrouter2")
	// debugPrintTree(0, 0, sr2.router[mGET].root, 0)
	// log.Println("")
	//
	// log.Println("~~subrouter3")
	// debugPrintTree(0, 0, sr3.router[mGET].root, 0)
	// log.Println("")
	//
	// log.Println("~~subrouter4")
	// debugPrintTree(0, 0, sr4.router[mGET].root, 0)
	// log.Println("")
	//
	// log.Println("~~subrouter5")
	// debugPrintTree(0, 0, sr5.router[mGET].root, 0)
	// log.Println("")
	//
	// log.Println("~~subrouter6")
	// debugPrintTree(0, 0, sr6.router[mGET].root, 0)
	// log.Println("")

	ts := httptest.NewServer(r)
	defer ts.Close()

	var resp, expected string

	resp = testRequest(t, ts, "GET", "/favicon.ico", nil)
	if resp != "fav" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/4/view", nil)
	if resp != "/hubs/4/view reqid:1" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/4/view/index.html", nil)
	if resp != "/hubs/4/view/index.html reqid:1" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/", nil)
	if resp != "/ reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/suggestions", nil)
	if resp != "/suggestions reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/woot/444/hiiii", nil)
	if resp != "/woot/444/hiiii" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123", nil)
	expected = "/hubs/123 reqid:1 session:elvis"
	if resp != expected {
		t.Fatalf("expected:%s got:%s", expected, resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123/touch", nil)
	if resp != "/hubs/123/touch reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123/webhooks", nil)
	if resp != "/hubs/123/webhooks reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123/posts", nil)
	if resp != "/hubs/123/posts reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/folders", nil)
	if resp != "404 page not found\n" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/folders/", nil)
	if resp != "/folders/ reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/folders/public", nil)
	if resp != "/folders/public reqid:1 session:elvis" {
		t.Fatalf("got '%s'", resp)
	}
	resp = testRequest(t, ts, "GET", "/folders/nothing", nil)
	if resp != "404 page not found\n" {
		t.Fatalf("got '%s'", resp)
	}
}

func TestMuxSubroutes(t *testing.T) {
	hHubView1 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hub1"))
	})
	hHubView2 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hub2"))
	})
	hHubView3 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("hub3"))
	})
	hAccountView1 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("account1"))
	})
	hAccountView2 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("account2"))
	})

	r := NewRouter()
	r.Get("/hubs/:hubID/view", hHubView1)
	r.Get("/hubs/:hubID/view/*", hHubView2)

	sr := NewRouter()
	sr.Get("/", hHubView3)
	r.Mount("/hubs/:hubID/users", sr)

	sr3 := NewRouter()
	sr3.Get("/", hAccountView1)
	sr3.Get("/hi", hAccountView2)

	var sr2 *Mux
	r.Route("/accounts/:accountID", func(r Router) {
		sr2 = r.(*Mux)
		r.Mount("/", sr3)
	})

	// TODO: support overriding the index method on a mount like:
	// r.Get("/users", UIndex)
	// r.Mount("/users", U) // assuming U router doesn't implement index route
	// .. currently for this to work, the index route must be defined separately

	// log.Println("")
	// log.Println("~~router:")
	// debugPrintTree(0, 0, r.router[mGET].root, 0)
	//
	// log.Println("")
	// log.Println("~~subrouter1:")
	// debugPrintTree(0, 0, sr.router[mGET].root, 0)
	// log.Println("")
	// log.Println("")
	//
	// log.Println("")
	// log.Println("~~subrouter2:")
	// debugPrintTree(0, 0, sr2.router[mGET].root, 0)
	// log.Println("")
	// log.Println("")
	//
	// log.Println("")
	// log.Println("~~subrouter3:")
	// debugPrintTree(0, 0, sr3.router[mGET].root, 0)
	// log.Println("")
	// log.Println("")

	ts := httptest.NewServer(r)
	defer ts.Close()

	var resp, expected string

	resp = testRequest(t, ts, "GET", "/hubs/123/view", nil)
	expected = "hub1"
	if resp != expected {
		t.Fatalf("expected:%s got:%s", expected, resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123/view/index.html", nil)
	expected = "hub2"
	if resp != expected {
		t.Fatalf("expected:%s got:%s", expected, resp)
	}
	resp = testRequest(t, ts, "GET", "/hubs/123/users", nil)
	expected = "hub3"
	if resp != expected {
		t.Fatalf("expected:%s got:%s", expected, resp)
	}
	resp = testRequest(t, ts, "GET", "/accounts/44", nil)
	expected = "account1"
	if resp != expected {
		t.Fatalf("request:%s expected:%s got:%s", "GET /accounts/44", expected, resp)
	}
	resp = testRequest(t, ts, "GET", "/accounts/44/hi", nil)
	expected = "account2"
	if resp != expected {
		t.Fatalf("expected:%s got:%s", expected, resp)
	}
}

func TestMuxFileServer(t *testing.T) {
	fixtures := map[string]http.File{
		"index.html": &testFile{"index.html", []byte("index\n")},
		"ok":         &testFile{"ok", []byte("ok\n")},
	}

	memfs := &testFileSystem{func(name string) (http.File, error) {
		name = name[1:]
		// if name == "" {
		// 	name = "index.html"
		// }
		if f, ok := fixtures[name]; ok {
			return f, nil
		}
		return nil, errors.New("file not found")
	}}

	r := NewRouter()
	r.FileServer("/mounted", memfs)
	r.Get("/hi", func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("bye"))
	})
	r.NotFound(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(404)
		w.Write([]byte("nothing here"))
	})
	r.FileServer("/", memfs)

	ts := httptest.NewServer(r)
	defer ts.Close()

	if resp := testRequest(t, ts, "GET", "/hi", nil); resp != "bye" {
		t.Fatalf(resp)
	}

	// HEADS UP: net/http notfoundhandler will kick-in for static assets
	if resp := testRequest(t, ts, "GET", "/mounted/nothing-here", nil); resp == "nothing here" {
		t.Fatalf(resp)
	}

	if resp := testRequest(t, ts, "GET", "/nothing-here", nil); resp == "nothing here" {
		t.Fatalf(resp)
	}

	if resp := testRequest(t, ts, "GET", "/mounted-nothing-here", nil); resp == "nothing here" {
		t.Fatalf(resp)
	}

	if resp := testRequest(t, ts, "GET", "/hi", nil); resp != "bye" {
		t.Fatalf(resp)
	}

	if resp := testRequest(t, ts, "GET", "/ok", nil); resp != "ok\n" {
		t.Fatalf(resp)
	}

	if resp := testRequest(t, ts, "GET", "/mounted/ok", nil); resp != "ok\n" {
		t.Fatalf(resp)
	}

	// TODO/FIX: testFileSystem mock struct.. it struggles to pass this since it gets
	// into a redirect loop, however, it does work with http.Dir() using the disk.
	// if resp := testRequest(t, ts, "GET", "/index.html", nil); resp != "index\n" {
	// 	t.Fatalf(resp)
	// }

	// if resp := testRequest(t, ts, "GET", "/", nil); resp != "index\n" {
	// 	t.Fatalf(resp)
	// }

	// if resp := testRequest(t, ts, "GET", "/mounted", nil); resp != "index\n" {
	// 	t.Fatalf(resp)
	// }

	// if resp := testRequest(t, ts, "GET", "/mounted/", nil); resp != "index\n" {
	// 	t.Fatalf(resp)
	// }
}

func urlParams(ctx context.Context) map[string]string {
	if rctx := RouteContext(ctx); rctx != nil {
		m := make(map[string]string, 0)
		for _, p := range rctx.Params {
			m[p.Key] = p.Value
		}
		return m
	}
	return nil
}

func testRequest(t *testing.T, ts *httptest.Server, method, path string, body io.Reader) string {
	req, err := http.NewRequest(method, ts.URL+path, body)
	if err != nil {
		t.Fatal(err)
		return ""
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
		return ""
	}

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
		return ""
	}
	defer resp.Body.Close()

	return string(respBody)
}

type testFileSystem struct {
	open func(name string) (http.File, error)
}

func (fs *testFileSystem) Open(name string) (http.File, error) {
	return fs.open(name)
}

type testFile struct {
	name     string
	contents []byte
}

func (tf *testFile) Close() error {
	return nil
}

func (tf *testFile) Read(p []byte) (n int, err error) {
	copy(p, tf.contents)
	return len(p), nil
}

func (tf *testFile) Seek(offset int64, whence int) (int64, error) {
	return 0, nil
}

func (tf *testFile) Readdir(count int) ([]os.FileInfo, error) {
	stat, _ := tf.Stat()
	return []os.FileInfo{stat}, nil
}

func (tf *testFile) Stat() (os.FileInfo, error) {
	return &testFileInfo{tf.name, int64(len(tf.contents))}, nil
}

type testFileInfo struct {
	name string
	size int64
}

func (tfi *testFileInfo) Name() string       { return tfi.name }
func (tfi *testFileInfo) Size() int64        { return tfi.size }
func (tfi *testFileInfo) Mode() os.FileMode  { return 0755 }
func (tfi *testFileInfo) ModTime() time.Time { return time.Now() }
func (tfi *testFileInfo) IsDir() bool        { return false }
func (tfi *testFileInfo) Sys() interface{}   { return nil }
