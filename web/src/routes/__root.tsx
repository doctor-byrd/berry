import { createRootRoute, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({
  component: () => (
    <>
      <nav>
        <Link to='/' className='[&.active]:font-bold'>Home</Link>
      </nav>
      <hr/>
      <main className="p-4">
        <Outlet/>
      </main>
    </>
  )
});
