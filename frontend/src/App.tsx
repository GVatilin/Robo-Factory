import { createBrowserRouter, Link, Outlet, RouterProvider, ScrollRestoration } from "react-router";

import AppShell, { RequirePermission } from "./app/AppShell";
import { AuthProvider } from "./auth/AuthContext";
import { CompareProvider } from "./compare/CompareContext";
import Landing from "./landing/Landing";
import { LoginPage, RegisterPage } from "./pages/AuthPages";
import ManufacturerFormPage from "./pages/catalog/ManufacturerFormPage";
import ManufacturerPage from "./pages/catalog/ManufacturerPage";
import ManufacturersPage from "./pages/catalog/ManufacturersPage";
import ProductPage from "./pages/catalog/ProductPage";
import ProductFormPage from "./pages/product-form/ProductFormPage";
import ComparePage from "./pages/solutions/ComparePage";
import SolutionsPage from "./pages/solutions/SolutionsPage";
import UsersPage from "./pages/UsersPage";
import { EmptyState } from "./ui/Controls";

function Root() {
  return (
    <AuthProvider>
      <CompareProvider>
        <ScrollRestoration />
        <Outlet />
      </CompareProvider>
    </AuthProvider>
  );
}

function NotFound() {
  return (
    <div className="page">
      <EmptyState title="Страница не найдена" action={<Link className="btn btn--ghost" to="/solutions">В каталог решений</Link>}>
        Проверьте адрес или вернитесь в каталог.
      </EmptyState>
    </div>
  );
}

const EDITORS = ["products:manage", "products:manage_own"] as const;

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
      {
        element: <AppShell />,
        children: [
          { path: "/solutions", element: <SolutionsPage /> },
          { path: "/compare", element: <ComparePage /> },
          { path: "/manufacturers", element: <ManufacturersPage /> },
          {
            path: "/manufacturers/new",
            element: (
              <RequirePermission permissions={["manufacturers:create"]}>
                <ManufacturerFormPage />
              </RequirePermission>
            ),
          },
          { path: "/manufacturers/:id", element: <ManufacturerPage /> },
          {
            path: "/manufacturers/:id/edit",
            element: (
              <RequirePermission permissions={["manufacturers:manage", "manufacturers:manage_own"]}>
                <ManufacturerFormPage />
              </RequirePermission>
            ),
          },
          {
            path: "/products/new",
            element: (
              <RequirePermission permissions={[...EDITORS]}>
                <ProductFormPage />
              </RequirePermission>
            ),
          },
          { path: "/products/:id", element: <ProductPage /> },
          {
            path: "/products/:id/edit",
            element: (
              <RequirePermission permissions={[...EDITORS]}>
                <ProductFormPage />
              </RequirePermission>
            ),
          },
          {
            path: "/admin/users",
            element: (
              <RequirePermission permissions={["users:manage"]}>
                <UsersPage />
              </RequirePermission>
            ),
          },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
