package chi

import (
	"fmt"
	"log"
	"net/http"
	"reflect"
	"testing"
)

var (
	emptyParams = map[string]string{}
)

func TestTree(t *testing.T) {
	hStub := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hIndex := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hFavicon := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleList := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleNear := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleShow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleShowRelated := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleShowOpts := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleSlug := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hArticleByUser := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hUserList := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hUserShow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hAdminCatchall := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hAdminAppShow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hAdminAppShowCatchall := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hUserProfile := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hUserSuper := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hUserAll := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hHubView1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hHubView2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hHubView3 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	tr := &node{}

	tr.InsertRoute(mGET, "/", hIndex)
	tr.InsertRoute(mGET, "/favicon.ico", hFavicon)

	tr.InsertRoute(mGET, "/pages/*", hStub)

	tr.InsertRoute(mGET, "/article", hArticleList)
	tr.InsertRoute(mGET, "/article/", hArticleList) // redirect..?

	tr.InsertRoute(mGET, "/article/near", hArticleNear)
	// tr.InsertRoute("/article/:sup", hStub) // will get overwritten as :id param
	tr.InsertRoute(mGET, "/article/:id", hStub)
	tr.InsertRoute(mGET, "/article/:id", hArticleShow)
	tr.InsertRoute(mGET, "/article/:id", hArticleShow) // duplicate will have no effect
	tr.InsertRoute(mGET, "/article/@:user", hArticleByUser)

	tr.InsertRoute(mGET, "/article/:sup/:opts", hArticleShowOpts) // TODO: and what if someone adds this?
	tr.InsertRoute(mGET, "/article/:id/:opts", hArticleShowOpts)

	tr.InsertRoute(mGET, "/article/:iffd/edit", hStub)
	tr.InsertRoute(mGET, "/article/:id//related", hArticleShowRelated)
	tr.InsertRoute(mGET, "/article/slug/:month/-/:day/:year", hArticleSlug)

	tr.InsertRoute(mGET, "/admin/user", hUserList)
	tr.InsertRoute(mGET, "/admin/user/", hStub) // will get replaced by next route
	tr.InsertRoute(mGET, "/admin/user/", hUserList)

	tr.InsertRoute(mGET, "/admin/user//:id", hUserShow)
	tr.InsertRoute(mGET, "/admin/user/:id", hUserShow)

	tr.InsertRoute(mGET, "/admin/apps/:id", hAdminAppShow)
	tr.InsertRoute(mGET, "/admin/apps/:id/*ff", hAdminAppShowCatchall)

	tr.InsertRoute(mGET, "/admin/*ff", hStub) // catchall segment will get replaced by next route
	tr.InsertRoute(mGET, "/admin/*", hAdminCatchall)

	tr.InsertRoute(mGET, "/users/:userID/profile", hUserProfile)
	tr.InsertRoute(mGET, "/users/super/*", hUserSuper)
	tr.InsertRoute(mGET, "/users/*", hUserAll)

	tr.InsertRoute(mGET, "/hubs/:hubID/view", hHubView1)
	tr.InsertRoute(mGET, "/hubs/:hubID/view/*", hHubView2)
	sr := NewRouter()
	sr.Get("/users", hHubView3)
	tr.InsertRoute(mGET, "/hubs/:hubID/*", sr)
	tr.InsertRoute(mGET, "/hubs/:hubID/users", hHubView3)

	// tr.InsertRoute("/debug*", hStub) // TODO: should we support this..?

	// TODO: test bad InsertRoutes ie.
	// tr.InsertRoute("")
	// tr.InsertRoute("/admin/:/joe/:/*") //...?
	// tr.InsertRoute("------------")

	tests := []struct {
		r string            // input request path
		h http.Handler      // output matched handler
		p map[string]string // output params
	}{
		{r: "/", h: hIndex, p: emptyParams},
		{r: "/favicon.ico", h: hFavicon, p: emptyParams},

		{r: "/pages", h: nil, p: emptyParams},
		{r: "/pages/", h: hStub, p: map[string]string{"*": ""}},
		{r: "/pages/yes", h: hStub, p: map[string]string{"*": "yes"}},

		{r: "/article", h: hArticleList, p: emptyParams},
		{r: "/article/", h: hArticleList, p: emptyParams},
		{r: "/article/near", h: hArticleNear, p: emptyParams},
		{r: "/article/neard", h: hArticleShow, p: map[string]string{"id": "neard"}},
		{r: "/article/123", h: hArticleShow, p: map[string]string{"id": "123"}},
		{r: "/article/123/456", h: hArticleShowOpts, p: map[string]string{"id": "123", "opts": "456"}},
		{r: "/article/@peter", h: hArticleByUser, p: map[string]string{"user": "peter"}},
		{r: "/article/22//related", h: hArticleShowRelated, p: map[string]string{"id": "22"}},
		{r: "/article/111/edit", h: hStub, p: map[string]string{"id": "111"}},
		{r: "/article/slug/sept/-/4/2015", h: hArticleSlug, p: map[string]string{"month": "sept", "day": "4", "year": "2015"}},
		{r: "/article/:id", h: hArticleShow, p: map[string]string{"id": ":id"}}, // TODO review goji?

		{r: "/admin/user", h: hUserList, p: emptyParams},
		{r: "/admin/user/", h: hUserList, p: emptyParams},
		{r: "/admin/user/1", h: hUserShow, p: map[string]string{"id": "1"}}, // hmmm.... TODO, review
		{r: "/admin/user//1", h: hUserShow, p: map[string]string{"id": "1"}},
		{r: "/admin/hi", h: hAdminCatchall, p: map[string]string{"*": "hi"}},
		{r: "/admin/lots/of/:fun", h: hAdminCatchall, p: map[string]string{"*": "lots/of/:fun"}},
		{r: "/admin/apps/333", h: hAdminAppShow, p: map[string]string{"id": "333"}},
		{r: "/admin/apps/333/woot", h: hAdminAppShowCatchall, p: map[string]string{"id": "333", "*": "woot"}},

		{r: "/hubs/123/view", h: hHubView1, p: map[string]string{"hubID": "123"}},
		{r: "/hubs/123/view/index.html", h: hHubView2, p: map[string]string{"hubID": "123", "*": "index.html"}},
		{r: "/hubs/123/users", h: hHubView3, p: map[string]string{"hubID": "123"}},

		{r: "/users/123/profile", h: hUserProfile, p: map[string]string{"userID": "123"}},
		{r: "/users/super/123/okay/yes", h: hUserSuper, p: map[string]string{"*": "123/okay/yes"}},
		{r: "/users/123/okay/yes", h: hUserAll, p: map[string]string{"*": "123/okay/yes"}},
	}

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, tr, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	for i, tt := range tests {
		// params := make(map[string]string, 0)
		rctx := NewRouteContext()

		handlers := tr.FindRoute(rctx, tt.r) //, params)
		handler, _ := handlers[mGET]

		params := urlParams(rctx)

		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: find '%s' expecting handler:%v , got:%v", i, tt.r, tt.h, handler)
		}
		if !reflect.DeepEqual(tt.p, params) {
			t.Errorf("input [%d]: find '%s' expecting params:%v , got:%v", i, tt.r, tt.p, params)
		}
	}
}

func debugPrintTree(parent int, i int, n *node, label byte) bool {
	numEdges := 0
	for _, nds := range n.children {
		numEdges += len(nds)
	}

	if n.handlers != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), numEdges, n.isLeaf(), n.handlers)
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), numEdges, n.isLeaf())
	}

	parent = i
	for _, nds := range n.children {
		for _, e := range nds {
			i++
			if debugPrintTree(parent, i, e, e.label) {
				return true
			}
		}
	}
	return false
}

func BenchmarkTreeGet(b *testing.B) {
	h1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	tr := &node{}
	tr.InsertRoute(mGET, "/", h1)
	tr.InsertRoute(mGET, "/ping", h2)
	tr.InsertRoute(mGET, "/pingall", h2)
	tr.InsertRoute(mGET, "/ping/:id", h2)
	tr.InsertRoute(mGET, "/ping/:id/woop", h2)
	tr.InsertRoute(mGET, "/ping/:id/:opt", h2)
	tr.InsertRoute(mGET, "/pinggggg", h2)
	tr.InsertRoute(mGET, "/hello", h1)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		// params := map[string]string{}
		mctx := NewRouteContext()
		tr.FindRoute(mctx, "/ping/123/456")
		// tr.Find("/pingggg", params)
	}
}

// func BenchmarkMuxGet(b *testing.B) {
// 	h1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
// 	h2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
// 	h3 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
//
// 	mx := NewRouter()
// 	mx.Get("/", h1)
// 	mx.Get("/hi", h2)
// 	mx.Get("/sup/:id/and/:this", h3)
//
// 	w := new(mockResponseWriter)
// 	r, _ := http.NewRequest("GET", "/sup/123/and/this", nil)
//
// 	b.ReportAllocs()
// 	b.ResetTimer()
//
// 	for i := 0; i < b.N; i++ {
// 		mx.ServeHTTP(w, r)
// 	}
// }
