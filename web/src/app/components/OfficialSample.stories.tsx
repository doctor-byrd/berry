import { Graphics } from 'pixi.js';

export default {
  title: 'Official Docs/Sample Box',
  // 1. Define the controls layout using Storybook's argTypes specification
  argTypes: {
    rotationSpeed: {
      control: { type: 'range', min: 0, max: 0.1, step: 0.005 },
      name: 'Rotation Speed',
    },
    boxColor: {
      control: { type: 'color' },
      name: 'Square Color',
    },
    squareSize: {
      control: { type: 'number', min: 50, max: 300, step: 10 },
      name: 'Square Size',
    }
  }
};

export const DefaultBox = {
  // 2. Set the initial default values for your controls
  args: {
    rotationSpeed: 0.02,
    boxColor: '#feeb77',
    squareSize: 150,
  }, 
  
  render: (args: any, context: any) => {
    let box: Graphics;

    return {
      init: (view: any) => {
        box = new Graphics();
        
        // Convert the string hex color from the Storybook picker (e.g. "#feeb77") 
        // into a numeric hex format that Pixi understands (e.g. 0xfeeb77)
        const activeColor = parseInt(args.boxColor.replace('#', '0x'), 16);

        // Draw the initial box shape based on controls input
        box.rect(-args.squareSize / 2, -args.squareSize / 2, args.squareSize, args.squareSize);
        box.fill(activeColor);
        
        box.position.set(250, 200);
        view.addChild(box);
      },
      
      update: (delta: number) => {
        if (box) {
          // 3. Read live changes directly from the reactive context stream!
          // This keeps the square spinning smoothly while you tweak values in real time.
          const currentSpeed = context.args.rotationSpeed;
          box.rotation += currentSpeed * delta;
        }
      },
      
      destroy: () => {
        if (box) {
          box.destroy();
        }
      }
    };
  }
};
