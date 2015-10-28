package chi

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/net/context"
)

func TestMux(t *testing.T) {
	var count uint64 = 0
	countermw := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			count += 1
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
		// TODO: params...
		idParam := URLParams(ctx)["id"] // from outside: chi.URLParams(ctx)

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

	//--

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, m.routes.root, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	//--

	// return

	// TODO: table-test a lot of this.........

	ts := httptest.NewServer(m)
	defer ts.Close()

	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /")

	// GET /
	resp, err := http.Get(ts.URL)
	if err != nil {
		t.Fatal(err)
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	expectedBody := "hi peter"
	if string(body) != string(expectedBody) {
		t.Error("expecting response body:", string(expectedBody))
	}

	tlogmsg, _ := logbuf.ReadString(0)
	if tlogmsg != logmsg {
		t.Error("expecting log message from middlware:", logmsg)
	}

	// log.Println("=> response:", string(body))
	// log.Println("")
	//
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping")

	// GET /ping
	resp, err = http.Get(ts.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if string(body) != "." {
		t.Error("expecting response body: .")
	}

	// log.Println("=> response:", string(body))
	// log.Println("")

	// GET / pingall
	resp, err = http.Get(ts.URL + "/pingall")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if string(body) != "ping all" {
		t.Error("expecting response body: .")
	}

	// log.Println("=> response:", string(body))

	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping/all")

	// GET / ping/all
	// TODO: this should be possible, as /all would be a known, set route and take precedence..
	// HMMM.. TODO: maybe this is the priority stuff that httprouter has............
	// so, we put /all higher than :id, etc.. therefore it will match first..
	// HRMM... TODO: can we use typ to help us sort priority..? are there other rules too?
	// TODO: rules ......
	//----------------------------------------------------------------------------------------
	//
	resp, err = http.Get(ts.URL + "/ping/all")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if string(body) != "ping all" {
		t.Error("expecting response body: 'ping all'")
	}

	// log.Println("=> response:", string(body))
	//
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping/all2")

	// GET /ping/all2
	resp, err = http.Get(ts.URL + "/ping/all2")
	// resp, err = http.Get(ts.URL + "/ping/:id")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	expectedBody = "ping all2"
	if string(body) != expectedBody {
		t.Errorf("expecting response body: '%s'", expectedBody)
	}

	// log.Printf("=> response: '%s'\n", string(body))
	// log.Println("")
	//
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping/123")

	// GET /ping/123
	resp, err = http.Get(ts.URL + "/ping/123")
	// resp, err = http.Get(ts.URL + "/ping/:id")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	expectedBody = "ping one id: 123"
	if string(body) != expectedBody {
		t.Errorf("expecting response body: '%s'", expectedBody)
	}

	// log.Printf("=> response: '%s'\n", string(body))
	// log.Println("")
	//
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping/allan")

	// GET /ping/allan
	resp, err = http.Get(ts.URL + "/ping/allan")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	expectedBody = "ping one id: allan"
	if string(body) != expectedBody {
		t.Errorf("expecting response body: '%s'", expectedBody)
	}

	// log.Printf("=> response: '%s'\n", string(body))
	// log.Println("")
	//
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~")
	// log.Println("~~~~~~~~~~~ GET /ping/1/woop")

	// GET /ping/1/woop
	resp, err = http.Get(ts.URL + "/ping/1/woop")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if string(body) != "woop." {
		t.Error("expecting response body: 'woop.'")
	}

	// log.Println("=> response:", string(body))
	// log.Println("")

	// HEAD /ping
	resp, err = http.Head(ts.URL + "/ping")
	if err != nil {
		t.Fatal(err)
	}

	if resp.StatusCode != 200 {
		t.Error("head failed, should be 200")
	}

	if resp.Header.Get("X-Ping") == "" {
		t.Error("expecting X-Ping header")
	}

	//---

	// GET /admin/catch-this
	resp, err = http.Get(ts.URL + "/admin/catch-thasdfsadfsfasfasfis")
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Error("get failed, should be 200")
	}

	if string(body) != "catchall" {
		t.Error("expecting response body: 'catchall'")
	}

	// POST /admin/catch-this
	resp, err = http.Post(ts.URL+"/admin/casdfsadfs", "text/plain", bytes.NewReader([]byte{}))
	if err != nil {
		t.Fatal(err)
	}

	body, err = ioutil.ReadAll(resp.Body)
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

}
