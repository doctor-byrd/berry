import React from 'react';

export default {
  title: 'React Components/Normal Button',
};

export const DefaultButton = {
  render: () => (
    <button 
      style={{
        padding: '10px 20px',
        backgroundColor: '#61dafb',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
        fontSize: '16px'
      }}
      onClick={() => alert('React rendering works fine!')}
    >
      Click Me (React)
    </button>
  ),
};
