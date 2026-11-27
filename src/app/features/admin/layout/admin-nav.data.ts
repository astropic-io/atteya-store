import { AdminNavCategory } from './admin-nav.model';

/** The admin menu (ATS-362): daily work first, then catalog, storefront and settings. */
export const ADMIN_NAV_CATEGORIES: readonly AdminNavCategory[] = [
  {
    id: 'sales',
    label: 'Sales & Orders',
    icon: 'shopping_cart',
    subItems: [
      {
        id: 'orders',
        label: 'Orders',
        path: '/admin/orders',
        icon: 'receipt_long',
        description: 'Track orders and check live product stock on each line',
      },
      {
        id: 'returns',
        label: 'Returns',
        path: '/admin/returns',
        icon: 'restart_alt',
        description: 'Return and exchange requests from customers',
      },
      {
        id: 'customers',
        label: 'Customers',
        path: '/admin/customers',
        icon: 'people',
        description: 'Everyone who placed an order or made an account',
      },
      {
        id: 'overview',
        label: 'Overview',
        path: '/admin/overview',
        icon: 'dashboard',
        description: 'How the store is doing: orders, sales, returns and stock',
        overview: true,
      },
    ],
  },
  {
    id: 'catalog',
    label: 'Catalog',
    icon: 'inventory_2',
    subItems: [
      {
        id: 'products',
        label: 'Products',
        path: '/admin/products',
        icon: 'sports_tennis',
        description: 'Add products and change how they show in the store',
      },
      {
        id: 'offers',
        label: 'Offers',
        path: '/admin/offers',
        icon: 'local_offer',
        description: 'Discounts, bundle deals, and scheduled promotions',
      },
      {
        id: 'categories',
        label: 'Categories & Brands',
        path: '/admin/categories',
        icon: 'category',
        description: 'Add, rename, reorder, show and hide categories and brands',
      },
      {
        id: 'players',
        label: 'Players',
        path: '/admin/settings/players',
        icon: 'person',
        description: 'Pro players shoppers can filter Shop by',
      },
    ],
  },
  {
    id: 'storefront',
    label: 'Storefront',
    icon: 'storefront',
    subItems: [
      {
        id: 'home-page',
        label: 'Home Page',
        path: '/admin/home',
        icon: 'view_quilt',
        description: 'Hero banners, promo sections, and homepage showcase',
      },
      {
        id: 'navigation-menus',
        label: 'Navigation & Menus',
        path: '/admin/navigation',
        icon: 'menu',
        description: 'Header menus, mega menu links, and release cards',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    subItems: [
      {
        id: 'shipping',
        label: 'Shipping',
        path: '/admin/settings/shipping',
        icon: 'local_shipping',
        description: 'Egypt and abroad delivery boxes, free shipping, and promotions',
      },
      {
        id: 'international',
        label: 'Outside Egypt',
        path: '/admin/settings/international',
        icon: 'public',
        description: 'Prices and currencies for customers outside Egypt',
      },
      {
        id: 'admins',
        label: 'Team',
        path: '/admin/settings/admins',
        icon: 'admin_panel_settings',
        description: 'Choose who can manage the store, as Admin or Staff',
        adminOnly: true,
      },
    ],
  },
];
