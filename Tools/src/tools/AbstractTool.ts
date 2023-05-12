export type Param = {
    name: string,
    description?: string,
    optional?: boolean,
};

export type BodyParam = Param & {
    type: "string" | "number" | "boolean" | "object" | "array",
};

abstract class AbstractTool {
    urlParams: Param[] = [];
    bodyParams: BodyParam[] = [];

    method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

    protected constructor(
        method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" = "GET",
        urlParams: Param[] = [],
        bodyParams: BodyParam[] = [],
    ) {
        this.method = method;
        this.urlParams = urlParams;
        this.bodyParams = bodyParams;
    }

    getUrl(): string {
        return `/${this.constructor.name.toLowerCase()}${this.urlParams.map(param => `/:${param.name}${param.optional ? '?' : ''}`).join('')}`;
    }

    abstract run(params: any, body: any): Promise<boolean>;
}

export default AbstractTool;