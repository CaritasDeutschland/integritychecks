import inxmailService from "./inxmailService.js";

const inxmailPagination = async (endpoint: string, query: any) => {
  const lastPage = new Date();
  lastPage.setHours(lastPage.getHours() - 3);

  let begin = new Date();
  begin.setHours(begin.getHours() - 2);
  if (query.begin) {
    begin = new Date(query.begin);
  }

  let end = new Date(begin);
  end.setHours(end.getHours() + 2);
  if (query.end) {
    end = new Date(query.end);
  }

  const next = new Date(begin);
  next.setHours(next.getHours() - 2);

  let results: any[] = [];
  let load = true;
  let page = 0;
  let hasContent = false;
  while(load) {
    const result = (await inxmailService.get(endpoint, {
      params: {
        ...query,
        begin: begin.toISOString(),
        end: end.toISOString(),
        size: 500,
        page: page++,
      }
    })).data;
    hasContent = result.page.totalElements > 0;
    results = results.concat(result._embedded[Object.keys(result._embedded)[0]]);
    if (!result._links.next) {
      load = false;
    }
  }

  return {
    results,
    begin,
    end,
    hasContent,
    prevLink: query.begin && `${lastPage.getTime() > end.getTime() ? `?begin=${end.toISOString()}` : ''}`,
    nextLink: `?begin=${next.toISOString()}&end=${begin.toISOString()}`
  };
};

export default inxmailPagination;