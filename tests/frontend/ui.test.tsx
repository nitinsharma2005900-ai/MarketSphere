// @vitest-environment jsdom
import React from 'react';
import {describe,it,expect,afterEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {Badge,StatusSteps,Empty,money} from '../../apps/frontend/components/ui';
afterEach(cleanup);
describe('customer status presentation',()=>{
  it('shows an accessible empty state with a useful next action',()=>{render(<Empty title="No orders" text="Find your first product."><a href="/catalog">Shop products</a></Empty>);expect(screen.getByRole('heading',{name:'No orders'})).toBeInTheDocument();expect(screen.getByRole('link')).toHaveAttribute('href','/catalog');});
  it('formats minor currency units without changing the authoritative amount',()=>{expect(money(1999)).toBe('₹19.99');});
  it('shows meaningful order steps and state text',()=>{render(<><Badge>PARTIALLY_FULFILLED</Badge><StatusSteps status="PARTIALLY_FULFILLED"/></>);expect(screen.getByText('partially fulfilled')).toBeInTheDocument();expect(screen.getByText('paid')).toBeInTheDocument();});
});
