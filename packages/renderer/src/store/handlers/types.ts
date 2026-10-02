export type Handler = (payload: any) => void;
export type HandlerMap = Record<string, Handler>;
