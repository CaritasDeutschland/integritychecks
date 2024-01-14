export type Param = {
    name: string,
    description?: string,
    optional?: boolean,
};

export type BodyParam = Param & {
    type: "string" | "number" | "boolean" | "object" | "array",
};

export type Deps = "mysql" | "rocketchat" | "inxmail" | "opensearch" | "mongo" | "keycloak";

export type PugTemplate = {
    type: 'pug',
    template: string,
    payload: any,
};

export type Redirect = {
    type: 'redirect',
    url: string,
}

export type Methods = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

abstract class AbstractTool {
    urlParams: Param[] = [];
    getParams: Param[] = [];
    bodyParams: BodyParam[] = [];
    deps: Deps[] = [];
    path: string = '';

    method: Methods[];

    protected constructor(
        method: Methods | Methods[] = "GET",
        urlParams: Param[] = [],
        bodyParams: BodyParam[] = [],
        getParams: Param[] = [],
    ) {
        this.method = Array.isArray(method) ? method : [method];
        this.urlParams = urlParams;
        this.bodyParams = bodyParams;
        this.getParams = getParams;
    }

    getUrl(): string {
        return `${this.path}/${this.constructor.name.toLowerCase()}${this.urlParams.map(param => `/:${param.name}${param.optional ? '?' : ''}`).join('')}`;
    }

    getDeps(): Deps[] {
        return this.deps;
    }

    abstract run(params: any, body: any, request: any, method: Methods): Promise<boolean | string | PugTemplate | Redirect>;
}

export default AbstractTool;