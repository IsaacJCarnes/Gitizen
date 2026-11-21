export interface GitizenApi {
  openRepo(): Promise<string | null>
  status(): Promise<any>
  log(): Promise<any>
  branches(): Promise<any>
  diff(path: string, staged: boolean): Promise<string>
  stage(paths: string[]): Promise<unknown>
  unstage(paths: string[]): Promise<unknown>
  commit(msg: string): Promise<unknown>
  checkout(branch: string): Promise<unknown>
}
declare global {
  interface Window {
    gitizen: GitizenApi
  }
}
