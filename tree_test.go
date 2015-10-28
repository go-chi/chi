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
	hStub := HandlerFunc(func(ctx context.Context, w http.ResponseWriter, r *http.Request) {})

	tr := &tree{root: &node{}}

	// TODO: add regexp

	tr.Insert("/", hIndex)
	tr.Insert("/favicon.ico", hFavicon)
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

	// tr.Insert(mGET, "/debug*", hStub) // TODO: should we support this..?

	// TODO: test bad inserts ie.
	// tr.Insert(mGET, "")
	// tr.Insert(mGET, "/admin/:/joe/:/*") //...?
	// tr.Insert(mGET, "------------")

	tests := []struct {
		m methodTyp         // input method
		r string            // input request path
		h Handler           // output matched handler
		p map[string]string // output params
	}{
		{m: mGET, r: "/", h: hIndex, p: emptyParams},
		{m: mGET, r: "/favicon.ico", h: hFavicon, p: emptyParams},
		{m: mGET, r: "/article", h: hArticleList, p: emptyParams},
		{m: mGET, r: "/article/", h: hArticleList, p: emptyParams},
		{m: mGET, r: "/article/near", h: hArticleNear, p: emptyParams},
		{m: mGET, r: "/article/neard", h: hArticleShow, p: map[string]string{"id": "neard"}},
		{m: mGET, r: "/article/123", h: hArticleShow, p: map[string]string{"id": "123"}},
		{m: mGET, r: "/article/123/456", h: hArticleShowOpts, p: map[string]string{"id": "123", "opts": "456"}},
		{m: mGET, r: "/article/@peter", h: hArticleByUser, p: map[string]string{"user": "peter"}},
		{m: mGET, r: "/article/22//related", h: hArticleShowRelated, p: map[string]string{"id": "22"}},
		{m: mGET, r: "/article/111/edit", h: hStub, p: map[string]string{"id": "111"}},
		{m: mGET, r: "/article/slug/sept/-/4/2015", h: hArticleSlug, p: map[string]string{"month": "sept", "day": "4", "year": "2015"}},
		{m: mGET, r: "/article/:id", h: hArticleShow, p: map[string]string{"id": ":id"}}, // TODO review goji?
		{m: mGET, r: "/admin/user", h: hUserList, p: emptyParams},
		{m: mGET, r: "/admin/user/", h: hUserList, p: emptyParams},
		{m: mGET, r: "/admin/user/1", h: hUserShow, p: map[string]string{"id": "1"}}, // hmmm.... TODO, review
		{m: mGET, r: "/admin/user//1", h: hUserShow, p: map[string]string{"id": "1"}},
		{m: mGET, r: "/admin/hi", h: hAdminCatchall, p: map[string]string{"*": "hi"}},
		{m: mGET, r: "/admin/lots/of/:fun", h: hAdminCatchall, p: map[string]string{"*": "lots/of/:fun"}},
		{m: mGET, r: "/admin/apps/333", h: hAdminAppShow, p: map[string]string{"id": "333"}},
		{m: mGET, r: "/admin/apps/333/woot", h: hAdminAppShowCatchall, p: map[string]string{"id": "333", "*": "woot"}},
	}

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, tr.root, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	for i, tt := range tests {
		params := make(map[string]string, 0)
		handler, _ := tr.Find(tt.r, params)
		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: '%s %s' expecting handler:%v , got:%v", i, tt.m.String(), tt.r, tt.h, handler)
		}
		if !reflect.DeepEqual(tt.p, params) {
			t.Errorf("input [%d]: '%s %s' expecting params:%v , got:%v", i, tt.m.String(), tt.r, tt.p, params)
		}
	}
}

func debugPrintTree(parent int, i int, n *node, label byte) bool {
	if n.handler != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v handler:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf(), n.handler)
		// return true
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s numEdges:%d isLeaf:%v\n", i, parent, n.typ, n.prefix, string(label), len(n.edges), n.isLeaf())
	}

	parent = i
	for _, e := range n.edges {
		i++
		if debugPrintTree(parent, i, e.node, e.label) {
			return true
		}
	}
	return false
}

func BenchmarkXTreeGet(b *testing.B) {
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
		var params map[string]string
		// tr.Find("/ping/123/456", params)
		tr.Find("/ping", params)
	}
}
