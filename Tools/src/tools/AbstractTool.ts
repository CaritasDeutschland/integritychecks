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

abstract class AbstractTool {
    urlParams: Param[] = [];
    getParams: Param[] = [];
    bodyParams: BodyParam[] = [];
    deps: Deps[] = [];
    path: string = '';

    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

    protected constructor(
        method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" = "GET",
        urlParams: Param[] = [],
        bodyParams: BodyParam[] = [],
        getParams: Param[] = [],
    ) {
        this.method = method;
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

    abstract run(params: any, body: any, request: any): Promise<boolean | string | PugTemplate | Redirect>;
}

export default AbstractTool;