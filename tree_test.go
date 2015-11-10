package chi

import (
	"fmt"
	"log"
	"net/http"
	"reflect"
	"testing"

	"golang.org/x/net/context"
)

var (
	emptyParams = map[string]string{}
)

func TestTree(t *testing.T) {
	hStub := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hIndex := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hFavicon := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleList := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleNear := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShow := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShowRelated := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleShowOpts := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleSlug := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hArticleByUser := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserList := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserShow := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hAdminCatchall := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hAdminAppShow := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hAdminAppShowCatchall := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserProfile := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserSuper := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hUserAll := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hHubView1 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hHubView2 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	hHubView3 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})

	tr := &tree{root: &node{}}

	tr.Insert("/", hIndex)
	tr.Insert("/favicon.ico", hFavicon)

	tr.Insert("/pages/*", hStub)

	tr.Insert("/article", hArticleList)
	tr.Insert("/article/", hArticleList) // redirect..?

	tr.Insert("/article/near", hArticleNear)
	// tr.Insert("/article/:sup", hStub) // will get overwritten as :id param TODO -- what does goji do..?
	tr.Insert("/article/:id", hStub)
	tr.Insert("/article/:id", hArticleShow)
	tr.Insert("/article/:id", hArticleShow) // duplicate will have no effect
	tr.Insert("/article/@:user", hArticleByUser)

	tr.Insert("/article/:sup/:opts", hArticleShowOpts) // TODO: and what if someone adds this?
	tr.Insert("/article/:id/:opts", hArticleShowOpts)

	tr.Insert("/article/:iffd/edit", hStub)
	tr.Insert("/article/:id//related", hArticleShowRelated)
	tr.Insert("/article/slug/:month/-/:day/:year", hArticleSlug)

	tr.Insert("/admin/user", hUserList)
	tr.Insert("/admin/user/", hStub) // will get replaced by next route
	tr.Insert("/admin/user/", hUserList)

	tr.Insert("/admin/user//:id", hUserShow)
	tr.Insert("/admin/user/:id", hUserShow) // TODO: how does goji handle those segments?

	tr.Insert("/admin/apps/:id", hAdminAppShow)
	tr.Insert("/admin/apps/:id/*ff", hAdminAppShowCatchall)

	tr.Insert("/admin/*ff", hStub) // catchall segment will get replaced by next route
	tr.Insert("/admin/*", hAdminCatchall)

	tr.Insert("/users/:userID/profile", hUserProfile)
	tr.Insert("/users/super/*", hUserSuper)
	tr.Insert("/users/*", hUserAll)

	tr.Insert("/hubs/:hubID/view", hHubView1)
	tr.Insert("/hubs/:hubID/view/*", hHubView2)
	sr := NewRouter()
	sr.Get("/users", hHubView3)
	tr.Insert("/hubs/:hubID/*", sr)
	tr.Insert("/hubs/:hubID/users", hHubView3)

	// tr.Insert("/debug*", hStub) // TODO: should we support this..?

	// TODO: test bad inserts ie.
	// tr.Insert("")
	// tr.Insert("/admin/:/joe/:/*") //...?
	// tr.Insert("------------")

	tests := []struct {
		r string            // input request path
		h Handler           // output matched handler
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
	// debugPrintTree(0, 0, tr.root, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	for i, tt := range tests {
		params := make(map[string]string, 0)
		handler := tr.Find(tt.r, params)
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
	for _, edges := range n.edges {
		numEdges += len(edges)
	}

	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), numEdges, n.isLeaf(), n.handler)
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), numEdges, n.isLeaf())
	}

	parent = i
	for _, edges := range n.edges {
		for _, e := range edges {
			i++
			if debugPrintTree(parent, i, e.node, e.label) {
				return true
			}
		}
	}
	return false
}

func BenchmarkTreeGet(b *testing.B) {
	h1 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
	h2 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})

	tr := &tree{root: &node{}}
	tr.Insert("/", h1)
	tr.Insert("/ping", h2)
	tr.Insert("/pingall", h2)
	tr.Insert("/ping/:id", h2)
	tr.Insert("/ping/:id/woop", h2)
	tr.Insert("/ping/:id/:opt", h2)
	tr.Insert("/pinggggg", h2)
	tr.Insert("/hello", h1)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		params := map[string]string{}
		tr.Find("/ping/123/456", params)
		// tr.Find("/pingggg", params)
	}
}

// func BenchmarkMuxGet(b *testing.B) {
// 	h1 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
// 	h2 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
// 	h3 := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})
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
