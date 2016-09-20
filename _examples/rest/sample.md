# github.com/pressly/chi/_examples/rest.Router

Intro goes here.

## Routes

<details>
<summary>/</summary>
  
**Middlewares**

* [RequestID](/github/source) - RequestID is a middleware that injects a request ID..
* [Logger]() - etc
* [Recoverer]() - adsfasdf

**Handlers**

GET / - main.main.func1
comment goes here..

</details>
<details>
<summary>/admin</summary>
</details>
<details>
<summary>/admin/accounts</summary>
</details>
<details>
<summary>/admin/users/:userId</summary>
</details>
<details>
<summary>/articles</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/articles**
  - _GET_
    - [main.paginate]()
    - [main.ListArticles]()
  - _POST_
    - [main.CreateArticle]()

</details>
<details>
<summary>/articles/:articleID</summary>

```
.
├── **_config.yml**
├── [_drafts](sup)
|   ├── begin-with-the-crazy-ideas.textile
|   └── on-simplicity-in-technology.markdown
├── _includes
|   ├── footer.html
|   └── header.html
├── _layouts
|   ├── default.html
|   └── post.html
├── _posts
|   ├── 2007-10-29-why-every-programmer-should-play-nethack.textile
|   └── 2009-04-26-barcamp-boston-4-roundup.textile
├── _data
|   └── members.yml
├── _site
└── index.html
```

</details>
<details>
<summary>/articles/search</summary>
</details>
<details>
<summary>/panic</summary>
</details>
<details>
<summary>/ping</summary>
</details>

