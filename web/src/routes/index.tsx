import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute('/')({
    component: HomeComponent,
});

function HomeComponent() {
    return (
        <div>
            <h1 className="text-2xl font-bold">Home page</h1>
        </div>
    );
}