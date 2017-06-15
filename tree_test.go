package chi

import (
	"fmt"
	"log"
	"net/http"
	"testing"
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
	tr.InsertRoute(mGET, "/article/", hArticleList)

	tr.InsertRoute(mGET, "/article/near", hArticleNear)
	tr.InsertRoute(mGET, "/article/{id}", hStub)
	tr.InsertRoute(mGET, "/article/{id}", hArticleShow)
	tr.InsertRoute(mGET, "/article/{id}", hArticleShow) // duplicate will have no effect
	tr.InsertRoute(mGET, "/article/@{user}", hArticleByUser)

	tr.InsertRoute(mGET, "/article/{sup}/{opts}", hArticleShowOpts)
	tr.InsertRoute(mGET, "/article/{id}/{opts}", hArticleShowOpts) // overwrite above route, latest wins

	tr.InsertRoute(mGET, "/article/{iffd}/edit", hStub)
	tr.InsertRoute(mGET, "/article/{id}//related", hArticleShowRelated)
	tr.InsertRoute(mGET, "/article/slug/{month}/-/{day}/{year}", hArticleSlug)

	tr.InsertRoute(mGET, "/admin/user", hUserList)
	tr.InsertRoute(mGET, "/admin/user/", hStub) // will get replaced by next route
	tr.InsertRoute(mGET, "/admin/user/", hUserList)

	tr.InsertRoute(mGET, "/admin/user//{id}", hUserShow)
	tr.InsertRoute(mGET, "/admin/user/{id}", hUserShow)

	tr.InsertRoute(mGET, "/admin/apps/{id}", hAdminAppShow)
	tr.InsertRoute(mGET, "/admin/apps/{id}/*ff", hAdminAppShowCatchall) // TODO: ALLOWED...? prob not.. panic..?

	tr.InsertRoute(mGET, "/admin/*ff", hStub) // catchall segment will get replaced by next route
	tr.InsertRoute(mGET, "/admin/*", hAdminCatchall)

	tr.InsertRoute(mGET, "/users/{userID}/profile", hUserProfile)
	tr.InsertRoute(mGET, "/users/super/*", hUserSuper)
	tr.InsertRoute(mGET, "/users/*", hUserAll)

	tr.InsertRoute(mGET, "/hubs/{hubID}/view", hHubView1)
	tr.InsertRoute(mGET, "/hubs/{hubID}/view/*", hHubView2)
	sr := NewRouter()
	sr.Get("/users", hHubView3)
	tr.InsertRoute(mGET, "/hubs/{hubID}/*", sr)
	tr.InsertRoute(mGET, "/hubs/{hubID}/users", hHubView3)

	tests := []struct {
		r string       // input request path
		h http.Handler // output matched handler
		k []string     // output param keys
		v []string     // output param values
	}{
		{r: "/", h: hIndex, k: []string{}, v: []string{}},
		{r: "/favicon.ico", h: hFavicon, k: []string{}, v: []string{}},

		{r: "/pages", h: nil, k: []string{}, v: []string{}},
		{r: "/pages/", h: hStub, k: []string{"*"}, v: []string{""}},
		{r: "/pages/yes", h: hStub, k: []string{"*"}, v: []string{"yes"}},

		{r: "/article", h: hArticleList, k: []string{}, v: []string{}},
		{r: "/article/", h: hArticleList, k: []string{}, v: []string{}},
		{r: "/article/near", h: hArticleNear, k: []string{}, v: []string{}},
		{r: "/article/neard", h: hArticleShow, k: []string{"id"}, v: []string{"neard"}},                                            //p: map[string]string{"id": "neard"},
		{r: "/article/123", h: hArticleShow, k: []string{"id"}, v: []string{"123"}},                                                //p: map[string]string{"id": "123"},
		{r: "/article/123/456", h: hArticleShowOpts, k: []string{"id", "opts"}, v: []string{"123", "456"}},                         //p: map[string]string{"id": "123", "opts": "456"},
		{r: "/article/@peter", h: hArticleByUser, k: []string{"user"}, v: []string{"peter"}},                                       //p: map[string]string{"user": "peter"},
		{r: "/article/22//related", h: hArticleShowRelated, k: []string{"id"}, v: []string{"22"}},                                  //p: map[string]string{"id": "22"},
		{r: "/article/111/edit", h: hStub, k: []string{"iffd"}, v: []string{"111"}},                                                //p: map[string]string{"id": "111"},
		{r: "/article/slug/sept/-/4/2015", h: hArticleSlug, k: []string{"month", "day", "year"}, v: []string{"sept", "4", "2015"}}, //p: map[string]string{"month": "sept", "day": "4", "year": "2015"},
		{r: "/article/:id", h: hArticleShow, k: []string{"id"}, v: []string{":id"}},                                                //p: map[string]string{"id": ":id"},

		{r: "/admin/user", h: hUserList, k: []string{}, v: []string{}},
		{r: "/admin/user/", h: hUserList, k: []string{}, v: []string{}},
		{r: "/admin/user/1", h: hUserShow, k: []string{"id"}, v: []string{"1"}},                                   //p: map[string]string{"id": "1"}, // hmmm.... TODO, review
		{r: "/admin/user//1", h: hUserShow, k: []string{"id"}, v: []string{"1"}},                                  //p: map[string]string{"id": "1"},
		{r: "/admin/hi", h: hAdminCatchall, k: []string{"*"}, v: []string{"hi"}},                                  //p: map[string]string{"*": "hi"},
		{r: "/admin/lots/of/:fun", h: hAdminCatchall, k: []string{"*"}, v: []string{"lots/of/:fun"}},              //p: map[string]string{"*": "lots/of/:fun"},
		{r: "/admin/apps/333", h: hAdminAppShow, k: []string{"id"}, v: []string{"333"}},                           //p: map[string]string{"id": "333"},
		{r: "/admin/apps/333/woot", h: hAdminAppShowCatchall, k: []string{"id", "*"}, v: []string{"333", "woot"}}, //p: map[string]string{"id": "333", "*": "woot"},

		{r: "/hubs/123/view", h: hHubView1, k: []string{"hubID"}, v: []string{"123"}},                               //p: map[string]string{"hubID": "123"},
		{r: "/hubs/123/view/index.html", h: hHubView2, k: []string{"hubID", "*"}, v: []string{"123", "index.html"}}, //p: map[string]string{"hubID": "123", "*": "index.html"},
		{r: "/hubs/123/users", h: hHubView3, k: []string{"hubID"}, v: []string{"123"}},                              //p: map[string]string{"hubID": "123"},

		{r: "/users/123/profile", h: hUserProfile, k: []string{"userID"}, v: []string{"123"}},          //p: map[string]string{"userID": "123"},
		{r: "/users/super/123/okay/yes", h: hUserSuper, k: []string{"*"}, v: []string{"123/okay/yes"}}, //p: map[string]string{"*": "123/okay/yes"},
		{r: "/users/123/okay/yes", h: hUserAll, k: []string{"*"}, v: []string{"123/okay/yes"}},         //p: map[string]string{"*": "123/okay/yes"},
	}

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, tr, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	for i, tt := range tests {
		rctx := NewRouteContext()

		handlers := tr.FindRoute(rctx, tt.r)
		handler, _ := handlers[mGET]

		paramKeys := rctx.routeParams.keys
		paramValues := rctx.routeParams.values

		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: find '%s' expecting handler:%v , got:%v", i, tt.r, tt.h, handler)
		}
		if !stringSliceEqual(tt.k, paramKeys) {
			t.Errorf("input [%d]: find '%s' expecting paramKeys:(%d)%v , got:(%d)%v", i, tt.r, len(tt.k), tt.k, len(paramKeys), paramKeys)
		}
		if !stringSliceEqual(tt.v, paramValues) {
			t.Errorf("input [%d]: find '%s' expecting paramValues:(%d)%v , got:(%d)%v", i, tt.r, len(tt.v), tt.v, len(paramValues), paramValues)
		}
	}
}

func TestTreeMoar(t *testing.T) {
	hStub := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub3 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub4 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub5 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub6 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub7 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub8 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub9 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	// TODO: if someone uses pattern /article/{id}/users/{id} then lets panic..
	// easy, except, what to do for subroutes..?
	// maybe there is a way...

	// TODO: panic if we see {id}{x} because we're missing a delimiter, its not possible.
	// also {:id}* is not possible.

	tr := &node{}

	tr.InsertRoute(mGET, "/articlefun", hStub5)
	tr.InsertRoute(mGET, "/articles/{id}", hStub)
	tr.InsertRoute(mGET, "/articles/search", hStub1)
	tr.InsertRoute(mGET, "/articles/{id}:delete", hStub8)
	tr.InsertRoute(mGET, "/articles/{iidd}!sup", hStub4)
	tr.InsertRoute(mGET, "/articles/{id}:{op}", hStub3)
	tr.InsertRoute(mGET, "/articles/{id}:{op}", hStub2)                              // this route sets a new handler for the above route
	tr.InsertRoute(mGET, "/articles/{slug:^[a-z]+}/posts", hStub)                    // up to tail '/' will only match if contents match the rex
	tr.InsertRoute(mGET, "/articles/{id}/posts/{pid}", hStub6)                       // /articles/123/posts/1
	tr.InsertRoute(mGET, "/articles/{id}/posts/{month}/{day}/{year}/{slug}", hStub7) // /articles/123/posts/09/04/1984/juice

	// TODO: make a separate test case for this one..
	// tr.InsertRoute(mGET, "/articles/{id}/{id}", hStub1)                              // panic expected, we're duplicating param keys

	tr.InsertRoute(mGET, "/pages/*ff", hStub) // TODO: panic, allow it..?
	tr.InsertRoute(mGET, "/pages/*", hStub9)

	tests := []struct {
		r string       // input request path
		h http.Handler // output matched handler
		k []string     // output param keys
		v []string     // output param values
	}{
		{r: "/articles/search", h: hStub1, k: []string{}, v: []string{}},
		{r: "/articlefun", h: hStub5, k: []string{}, v: []string{}},
		{r: "/articles/123", h: hStub, k: []string{"id"}, v: []string{"123"}},
		{r: "/articles/789:delete", h: hStub8, k: []string{"id"}, v: []string{"789"}},
		{r: "/articles/789!sup", h: hStub4, k: []string{"iidd"}, v: []string{"789"}},
		{r: "/articles/123:sync", h: hStub2, k: []string{"id", "op"}, v: []string{"123", "sync"}},
		{r: "/articles/456/posts/1", h: hStub6, k: []string{"id", "pid"}, v: []string{"456", "1"}},
		{r: "/articles/456/posts/09/04/1984/juice", h: hStub7, k: []string{"id", "month", "day", "year", "slug"}, v: []string{"456", "09", "04", "1984", "juice"}},
		{r: "/pages", h: nil, k: []string{}, v: []string{}},
		{r: "/pages/", h: hStub9, k: []string{"*"}, v: []string{""}},
		{r: "/pages/yes", h: hStub9, k: []string{"*"}, v: []string{"yes"}},
	}

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, tr, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	for i, tt := range tests {
		rctx := NewRouteContext()

		handlers := tr.FindRoute(rctx, tt.r)
		handler, _ := handlers[mGET]

		paramKeys := rctx.routeParams.keys
		paramValues := rctx.routeParams.values

		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: find '%s' expecting handler:%v , got:%v", i, tt.r, tt.h, handler)
		}
		if !stringSliceEqual(tt.k, paramKeys) {
			t.Errorf("input [%d]: find '%s' expecting paramKeys:(%d)%v , got:(%d)%v", i, tt.r, len(tt.k), tt.k, len(paramKeys), paramKeys)
		}
		if !stringSliceEqual(tt.v, paramValues) {
			t.Errorf("input [%d]: find '%s' expecting paramValues:(%d)%v , got:(%d)%v", i, tt.r, len(tt.v), tt.v, len(paramValues), paramValues)
		}
	}
}

func TestTreeRegexp(t *testing.T) {
	hStub1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub3 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub4 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub5 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub6 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	tr := &node{}
	tr.InsertRoute(mGET, "/articles/{zid:^0[0-9]+}", hStub3)
	tr.InsertRoute(mGET, "/articles/{name:^@[a-z]+}/posts", hStub4)
	tr.InsertRoute(mGET, "/articles/{op:^[0-9]+}/run", hStub5)
	tr.InsertRoute(mGET, "/articles/{id:^[0-9]+}", hStub1)
	tr.InsertRoute(mGET, "/articles/{id:^[1-9]+}-{aux}", hStub6)
	tr.InsertRoute(mGET, "/articles/{slug}", hStub2)

	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")
	// debugPrintTree(0, 0, tr, 0)
	// log.Println("~~~~~~~~~")
	// log.Println("~~~~~~~~~")

	tests := []struct {
		r string       // input request path
		h http.Handler // output matched handler
		k []string     // output param keys
		v []string     // output param values
	}{
		{r: "/articles", h: nil, k: []string{}, v: []string{}},
		{r: "/articles/123", h: hStub1, k: []string{"id"}, v: []string{"123"}},
		{r: "/articles/how-to-build-a-router", h: hStub2, k: []string{"slug"}, v: []string{"how-to-build-a-router"}},
		{r: "/articles/0456", h: hStub3, k: []string{"zid"}, v: []string{"0456"}},
		{r: "/articles/@pk/posts", h: hStub4, k: []string{"name"}, v: []string{"@pk"}},
		{r: "/articles/1/run", h: hStub5, k: []string{"op"}, v: []string{"1"}},
		{r: "/articles/1122", h: hStub1, k: []string{"id"}, v: []string{"1122"}},
		{r: "/articles/1122-yes", h: hStub6, k: []string{"id", "aux"}, v: []string{"1122", "yes"}},
	}

	for i, tt := range tests {
		rctx := NewRouteContext()

		handlers := tr.FindRoute(rctx, tt.r)
		handler, _ := handlers[mGET]

		paramKeys := rctx.routeParams.keys
		paramValues := rctx.routeParams.values

		if fmt.Sprintf("%v", tt.h) != fmt.Sprintf("%v", handler) {
			t.Errorf("input [%d]: find '%s' expecting handler:%v , got:%v", i, tt.r, tt.h, handler)
		}
		if !stringSliceEqual(tt.k, paramKeys) {
			t.Errorf("input [%d]: find '%s' expecting paramKeys:(%d)%v , got:(%d)%v", i, tt.r, len(tt.k), tt.k, len(paramKeys), paramKeys)
		}
		if !stringSliceEqual(tt.v, paramValues) {
			t.Errorf("input [%d]: find '%s' expecting paramValues:(%d)%v , got:(%d)%v", i, tt.r, len(tt.v), tt.v, len(paramValues), paramValues)
		}
	}
}

func TestTreeMatchPattern(t *testing.T) {
	hStub1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	hStub3 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	tr := &node{}
	tr.InsertRoute(mGET, "/pages/*", hStub1)
	tr.InsertRoute(mGET, "/articles/{id}/*", hStub2)
	tr.InsertRoute(mGET, "/articles/{slug}/{uid}/*", hStub3)

	if tr.matchPattern("/pages") != false {
		t.Errorf("find /pages failed")
	}
	if tr.matchPattern("/pages*") != false {
		t.Errorf("find /pages* failed - should be nil")
	}
	if tr.matchPattern("/pages/*") == false {
		t.Errorf("find /pages/* failed")
	}
	if tr.matchPattern("/articles/{id}/*") == false {
		t.Errorf("find /articles/{id}/* failed")
	}
	if tr.matchPattern("/articles/{something}/*") == false {
		t.Errorf("find /articles/{something}/* failed")
	}
	if tr.matchPattern("/articles/{slug}/{uid}/*") == false {
		t.Errorf("find /articles/{slug}/{uid}/* failed")
	}
}

func debugPrintTree(parent int, i int, n *node, label byte) bool {
	numEdges := 0
	for _, nds := range n.children {
		numEdges += len(nds)
	}

	if n.handlers != nil {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s tail:%s numEdges:%d isLeaf:%v handler:%v pat:%s keys:%v\n", i, parent, n.typ, n.prefix, string(label), string(n.tail), numEdges, n.isLeaf(), n.handlers, n.pattern, n.paramKeys)
	} else {
		log.Printf("[node %d parent:%d] typ:%d prefix:%s label:%s tail:%s numEdges:%d isLeaf:%v pat:%s keys:%v\n", i, parent, n.typ, n.prefix, string(label), string(n.tail), numEdges, n.isLeaf(), n.pattern, n.paramKeys)
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

func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i, _ := range a {
		if b[i] != a[i] {
			return false
		}
	}
	return true
}

func BenchmarkTreeGet(b *testing.B) {
	h1 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})
	h2 := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {})

	tr := &node{}
	tr.InsertRoute(mGET, "/", h1)
	tr.InsertRoute(mGET, "/ping", h2)
	tr.InsertRoute(mGET, "/pingall", h2)
	tr.InsertRoute(mGET, "/ping/{id}", h2)
	tr.InsertRoute(mGET, "/ping/{id}/woop", h2)
	tr.InsertRoute(mGET, "/ping/{id}/{opt}", h2)
	tr.InsertRoute(mGET, "/pinggggg", h2)
	tr.InsertRoute(mGET, "/hello", h1)

	b.ReportAllocs()
	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		mctx := NewRouteContext()
		tr.FindRoute(mctx, "/ping/123/456")
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
// 	mx.Get("/sup/{id}/and/{this}", h3)
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
