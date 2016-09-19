# github.com/pressly/chi/_examples/rest

Routing docs generated with chi/docgen. Run xx to regenerate the docs.

## Routes

<details>
<summary>/admin/users/:userId</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/admin**
	- [main.AdminOnly]()
	- **/users/:userId**
		- _GET_
			- [main.adminRouter.func3]()

</details>
<details>
<summary>/articles/</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/articles**
	- **/**
		- _POST_
			- [main.CreateArticle]()
		- _GET_
			- [main.paginate]()
			- [main.ListArticles]()

</details>
<details>
<summary>/articles/search</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/articles**
	- **/search**
		- _GET_
			- [main.SearchArticles]()

</details>
<details>
<summary>/panic</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/panic**
	- _GET_
		- [main.main.func3]()

</details>
<details>
<summary>/admin/accounts</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/admin**
	- [main.AdminOnly]()
	- **/accounts**
		- _GET_
			- [main.adminRouter.func2]()

</details>
<details>
<summary>/admin/</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/admin**
	- [main.AdminOnly]()
	- **/**
		- _GET_
			- [main.adminRouter.func1]()

</details>
<details>
<summary>/articles/:articleID/</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/articles**
	- **/:articleID**
		- [main.ArticleCtx]()
		- **/**
			- _PUT_
				- [main.UpdateArticle]()
			- _DELETE_
				- [main.DeleteArticle]()
			- _GET_
				- [main.GetArticle]()

</details>
<details>
<summary>/ping</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/ping**
	- _GET_
		- [main.main.func2]()

</details>
<details>
<summary>/</summary>

- [RequestID]()
- [Logger]()
- [Recoverer]()
- **/**
	- _GET_
		- [main.main.func1]()

</details>

