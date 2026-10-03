import definitions from '../../config/test-products.json';
import { initializeStore } from './store-controller.mjs';

initializeStore({ definitions, testShop: true });
