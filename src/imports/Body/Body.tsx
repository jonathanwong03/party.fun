import svgPaths from "./svg-t941o4i2ip";
import imgContainer from "./d7740346dff29f9ce3c22379911fcf88a26849b3.png";

function Icon() {
  return (
    <div className="absolute left-0 size-[14px] top-[3px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 14">
        <g id="Icon">
          <path d="M8.75 10.5L5.25 7L8.75 3.5" id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.16667" />
        </g>
      </svg>
    </div>
  );
}

function Button() {
  return (
    <div className="absolute h-[20px] left-[226.67px] top-[97px] w-[118.781px]" data-name="Button">
      <Icon />
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] left-[68.5px] text-[#8a8a99] text-[14px] text-center top-[-0.33px] whitespace-nowrap">{` Back to events`}</p>
    </div>
  );
}

function Text() {
  return <div className="absolute bg-[#ffcb3c] left-[10px] rounded-[22369600px] size-[6px] top-[9px]" data-name="Text" />;
}

function StatusBadge() {
  return (
    <div className="absolute bg-[rgba(255,203,60,0.12)] h-[24px] left-[24px] rounded-[22369600px] top-[260.41px] w-[107.573px]" data-name="StatusBadge">
      <Text />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[16px] left-[22px] text-[#ffd968] text-[12px] top-[4px] whitespace-nowrap">Almost There</p>
    </div>
  );
}

function Heading() {
  return (
    <div className="absolute h-[39.594px] left-[24px] top-[296.41px] w-[472.698px]" data-name="Heading 1">
      <p className="[word-break:break-word] absolute font-['Inter:Extra_Bold',sans-serif] font-extrabold leading-[39.6px] left-0 not-italic text-[36px] text-white top-0 tracking-[-0.72px] whitespace-nowrap">Neon Jungle: Freshers Rave</p>
    </div>
  );
}

function Paragraph() {
  return (
    <div className="absolute h-[20px] left-[24px] top-[340px] w-[472.698px]" data-name="Paragraph">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[20px] left-0 text-[14px] text-[rgba(255,255,255,0.7)] top-[-0.33px] whitespace-nowrap">Hosted by NUS Electronic Music Club</p>
    </div>
  );
}

function Container() {
  return (
    <div className="absolute h-[384px] left-[226.67px] overflow-clip rounded-[24px] top-[133px] w-[1104px]" data-name="Container">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none rounded-[24px]">
        <img alt="" className="absolute max-w-none object-cover rounded-[24px] size-full" src={imgContainer} />
        <div className="absolute bg-gradient-to-t from-[#0b0b0f] inset-0 rounded-[24px] to-[rgba(0,0,0,0)] via-1/2 via-[rgba(11,11,15,0.3)]" />
      </div>
      <StatusBadge />
      <Heading />
      <Paragraph />
    </div>
  );
}

function Icon1() {
  return (
    <div className="absolute left-0 size-[13px] top-[1.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 13 13">
        <g id="Icon">
          <path d="M4.33333 1.08333V3.25" id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d="M8.66667 1.08333V3.25" id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p3b7aed80} id="Vector_3" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d="M1.625 5.41667H11.375" id="Vector_4" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
        </g>
      </svg>
    </div>
  );
}

function Container4() {
  return (
    <div className="h-[16px] relative shrink-0 w-full" data-name="Container">
      <Icon1 />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[21px] text-[#8a8a99] text-[12px] top-0 whitespace-nowrap">{` Date`}</p>
    </div>
  );
}

function Container5() {
  return (
    <div className="h-[24px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[24px] left-0 text-[#f5f5f7] text-[16px] top-[-0.67px] whitespace-nowrap">Fri, Jun 12</p>
    </div>
  );
}

function Container3() {
  return (
    <div className="absolute bg-[#14141b] content-stretch flex flex-col gap-[4px] h-[77.333px] items-start left-0 pb-[0.667px] pt-[16.667px] px-[16.667px] rounded-[14px] top-0 w-[161px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <Container4 />
      <Container5 />
    </div>
  );
}

function Icon2() {
  return (
    <div className="absolute left-0 size-[13px] top-[1.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 13 13">
        <g clipPath="url(#clip0_111_2812)" id="Icon">
          <path d={svgPaths.p1d11280} id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p2fb53000} id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
        </g>
        <defs>
          <clipPath id="clip0_111_2812">
            <rect fill="white" height="13" width="13" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Container7() {
  return (
    <div className="h-[16px] relative shrink-0 w-full" data-name="Container">
      <Icon2 />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[21px] text-[#8a8a99] text-[12px] top-0 whitespace-nowrap">{` Time`}</p>
    </div>
  );
}

function Container8() {
  return (
    <div className="h-[24px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[24px] left-0 text-[#f5f5f7] text-[16px] top-[-0.67px] whitespace-nowrap">10:00 PM</p>
    </div>
  );
}

function Container6() {
  return (
    <div className="absolute bg-[#14141b] content-stretch flex flex-col gap-[4px] h-[77.333px] items-start left-[177px] pb-[0.667px] pt-[16.667px] px-[16.667px] rounded-[14px] top-0 w-[161px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <Container7 />
      <Container8 />
    </div>
  );
}

function Icon3() {
  return (
    <div className="absolute left-0 size-[13px] top-[1.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 13 13">
        <g id="Icon">
          <path d={svgPaths.p12f44a00} id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p37a0d000} id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
        </g>
      </svg>
    </div>
  );
}

function Container10() {
  return (
    <div className="h-[16px] relative shrink-0 w-full" data-name="Container">
      <Icon3 />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[21px] text-[#8a8a99] text-[12px] top-0 whitespace-nowrap">{` Location`}</p>
    </div>
  );
}

function Container11() {
  return (
    <div className="h-[24px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[24px] left-0 text-[#f5f5f7] text-[16px] top-[-0.67px] whitespace-nowrap">The Projector</p>
    </div>
  );
}

function Container9() {
  return (
    <div className="absolute bg-[#14141b] content-stretch flex flex-col gap-[4px] h-[77.333px] items-start left-[354px] pb-[0.667px] pt-[16.667px] px-[16.667px] rounded-[14px] top-0 w-[161px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <Container10 />
      <Container11 />
    </div>
  );
}

function Icon4() {
  return (
    <div className="absolute left-0 size-[13px] top-[1.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 13 13">
        <g id="Icon">
          <path d={svgPaths.p223dec00} id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p3a2f1500} id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p39eb6800} id="Vector_3" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
          <path d={svgPaths.p12c6f180} id="Vector_4" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.08333" />
        </g>
      </svg>
    </div>
  );
}

function Container13() {
  return (
    <div className="h-[16px] relative shrink-0 w-full" data-name="Container">
      <Icon4 />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[21px] text-[#8a8a99] text-[12px] top-0 whitespace-nowrap">{` Spots left`}</p>
    </div>
  );
}

function Container14() {
  return (
    <div className="h-[24px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[24px] left-0 text-[#f5f5f7] text-[16px] top-[-0.67px] whitespace-nowrap">244</p>
    </div>
  );
}

function Container12() {
  return (
    <div className="absolute bg-[#14141b] content-stretch flex flex-col gap-[4px] h-[77.333px] items-start left-[531px] pb-[0.667px] pt-[16.667px] px-[16.667px] rounded-[14px] top-0 w-[161px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <Container13 />
      <Container14 />
    </div>
  );
}

function Container2() {
  return (
    <div className="h-[77.333px] relative shrink-0 w-full" data-name="Container">
      <Container3 />
      <Container6 />
      <Container9 />
      <Container12 />
    </div>
  );
}

function Heading1() {
  return (
    <div className="h-[30px] relative shrink-0 w-full" data-name="Heading 2">
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[30px] left-0 not-italic text-[#f5f5f7] text-[20px] top-[-0.33px] whitespace-nowrap">About this party</p>
    </div>
  );
}

function Paragraph1() {
  return (
    <div className="h-[48px] relative shrink-0 w-full" data-name="Paragraph">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[24px] left-0 text-[#8a8a99] text-[16px] top-[-0.67px] w-[692px]">A night of bass-heavy beats, UV body paint and free-flow mocktails. Capping our orientation week with the loudest party on campus.</p>
    </div>
  );
}

function Container15() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] h-[90px] items-start relative shrink-0 w-full" data-name="Container">
      <Heading1 />
      <Paragraph1 />
    </div>
  );
}

function Container18() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px] tracking-[0.6px] uppercase">Ticket prices over time</p>
    </div>
  );
}

function Container20() {
  return (
    <div className="bg-[#00f991] flex-[160.333_0_0] h-[34.667px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] relative shrink-0 text-[14px] text-black whitespace-nowrap">$12</p>
      </div>
    </div>
  );
}

function Container21() {
  return (
    <div className="bg-[#fee900] flex-[160.333_0_0] h-[34.667px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] relative shrink-0 text-[14px] text-black whitespace-nowrap">$18</p>
      </div>
    </div>
  );
}

function Container22() {
  return (
    <div className="bg-[#f46303] flex-[160.333_0_0] h-[34.667px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] relative shrink-0 text-[14px] text-black whitespace-nowrap">$25</p>
      </div>
    </div>
  );
}

function Container23() {
  return (
    <div className="bg-[#ff0a0a] flex-[160.333_0_0] h-[34.667px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-center relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] relative shrink-0 text-[14px] text-white whitespace-nowrap">$32 flat</p>
      </div>
    </div>
  );
}

function Container19() {
  return (
    <div className="h-[36px] relative rounded-[20px] shrink-0 w-full" data-name="Container">
      <div className="overflow-clip rounded-[inherit] size-full">
        <div className="content-stretch flex items-start p-[0.667px] relative size-full">
          <Container20 />
          <Container21 />
          <Container22 />
          <Container23 />
        </div>
      </div>
      <div aria-hidden="true" className="absolute border-[0.667px] border-black border-solid inset-0 pointer-events-none rounded-[20px]" />
    </div>
  );
}

function Container17() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[8px] h-[60px] items-start left-[24.67px] top-[24.67px] w-[642.667px]" data-name="Container">
      <Container18 />
      <Container19 />
    </div>
  );
}

function Heading2() {
  return (
    <div className="absolute h-[27px] left-[24.67px] top-[104.67px] w-[100.427px]" data-name="Heading 3">
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-0 not-italic text-[#f5f5f7] text-[18px] top-0 whitespace-nowrap">Hype meter</p>
    </div>
  );
}

function Text1() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start left-[520.23px] top-[112px] w-[147.104px]" data-name="Text">
      <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">Deadline: Jun 10, 11:59 PM</p>
    </div>
  );
}

function Container26() {
  return (
    <div className="h-[36px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[36px] left-0 text-[36px] text-white top-[-0.33px] whitespace-nowrap">78%</p>
    </div>
  );
}

function Container27() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">156 of 200 backers</p>
    </div>
  );
}

function Container25() {
  return (
    <div className="h-[56px] relative shrink-0 w-[109.521px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[4px] items-start relative size-full">
        <Container26 />
        <Container27 />
      </div>
    </div>
  );
}

function Text2() {
  return <div className="absolute bg-[#ffcb3c] left-[10px] rounded-[22369600px] shadow-[0px_0px_6px_0px_#ffcb3c] size-[6px] top-[9px]" data-name="Text" />;
}

function Container28() {
  return (
    <div className="bg-[rgba(255,203,60,0.09)] h-[24px] relative rounded-[22369600px] shrink-0 w-[151.906px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Text2 />
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[22px] text-[#ffcb3c] text-[12px] top-[4px] whitespace-nowrap">Tier 2 · Growing hype</p>
      </div>
    </div>
  );
}

function Container24() {
  return (
    <div className="absolute content-stretch flex h-[56px] items-end justify-between left-[24.67px] top-[147.67px] w-[642.667px]" data-name="Container">
      <Container25 />
      <Container28 />
    </div>
  );
}

function Container30() {
  return <div className="bg-white h-[12px] relative rounded-[22369600px] shadow-[0px_0px_10px_0px_rgba(255,255,255,0.35)] shrink-0 w-full" data-name="Container" />;
}

function Container29() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.06)] content-stretch flex flex-col h-[12px] items-start left-[24.67px] overflow-clip pr-[141.396px] rounded-[22369600px] top-[215.67px] w-[642.667px]" data-name="Container">
      <Container30 />
    </div>
  );
}

function Text3() {
  return (
    <div className="h-[16px] relative shrink-0 w-[7.698px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-start relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">0</p>
      </div>
    </div>
  );
}

function Text4() {
  return (
    <div className="h-[16px] relative shrink-0 w-[69.354px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-start relative size-full">
        <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[16px] relative shrink-0 text-[12px] text-white whitespace-nowrap">200 needed</p>
      </div>
    </div>
  );
}

function Container31() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start justify-between left-[24.67px] top-[235.67px] w-[642.667px]" data-name="Container">
      <Text3 />
      <Text4 />
    </div>
  );
}

function Icon5() {
  return (
    <div className="absolute left-0 size-[12px] top-[2px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 12 12">
        <g id="Icon">
          <path d="M5 1H7" id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 7L7.5 5.5" id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" />
          <path d={svgPaths.p5139500} id="Vector_3" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </svg>
    </div>
  );
}

function Text5() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start left-[516.79px] top-0 w-[92.542px]" data-name="Text">
      <p className="[word-break:break-word] font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[16px] relative shrink-0 text-[#f5f5f7] text-[12px] whitespace-nowrap">Jun 10, 11:59 PM</p>
    </div>
  );
}

function Container33() {
  return (
    <div className="h-[16px] relative shrink-0 w-full" data-name="Container">
      <Icon5 />
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-[18px] text-[#8a8a99] text-[12px] top-0 whitespace-nowrap">{` Hype deadline`}</p>
      <Text5 />
    </div>
  );
}

function Container36() {
  return (
    <div className="bg-[rgba(255,255,255,0.06)] flex-[1_0_0] min-h-px relative rounded-[10px] w-[52.167px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[33px] left-[26.5px] text-[#ffcb3c] text-[22px] text-center top-[8px] tracking-[0.44px] whitespace-nowrap">03</p>
      </div>
    </div>
  );
}

function Container37() {
  return (
    <div className="h-[15px] relative shrink-0 w-[15.021px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] tracking-[1px] uppercase whitespace-nowrap">DD</p>
      </div>
    </div>
  );
}

function Container35() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[4px] h-[68px] items-center left-0 top-0 w-[52.167px]" data-name="Container">
      <Container36 />
      <Container37 />
    </div>
  );
}

function Container38() {
  return (
    <div className="absolute h-[28px] left-[60.17px] opacity-40 top-[20px] w-[5.365px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[28px] left-0 text-[#ffcb3c] text-[18px] top-0 whitespace-nowrap">:</p>
    </div>
  );
}

function Container34() {
  return (
    <div className="h-[68px] relative shrink-0 w-[65.531px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container35 />
        <Container38 />
      </div>
    </div>
  );
}

function Container41() {
  return (
    <div className="bg-[rgba(255,255,255,0.06)] flex-[1_0_0] min-h-px relative rounded-[10px] w-[52.167px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[33px] left-[26.5px] text-[#ffcb3c] text-[22px] text-center top-[8px] tracking-[0.44px] whitespace-nowrap">00</p>
      </div>
    </div>
  );
}

function Container42() {
  return (
    <div className="h-[15px] relative shrink-0 w-[15.125px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] tracking-[1px] uppercase whitespace-nowrap">HH</p>
      </div>
    </div>
  );
}

function Container40() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[4px] h-[68px] items-center left-0 top-0 w-[52.167px]" data-name="Container">
      <Container41 />
      <Container42 />
    </div>
  );
}

function Container43() {
  return (
    <div className="absolute h-[28px] left-[60.17px] opacity-40 top-[20px] w-[5.365px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[28px] left-0 text-[#ffcb3c] text-[18px] top-0 whitespace-nowrap">:</p>
    </div>
  );
}

function Container39() {
  return (
    <div className="h-[68px] relative shrink-0 w-[65.531px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container40 />
        <Container43 />
      </div>
    </div>
  );
}

function Container45() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.06)] h-[49px] left-0 rounded-[10px] top-0 w-[52.167px]" data-name="Container">
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[33px] left-[26.5px] text-[#ffcb3c] text-[22px] text-center top-[8px] tracking-[0.44px] whitespace-nowrap">17</p>
    </div>
  );
}

function Container46() {
  return (
    <div className="absolute h-[15px] left-[16.43px] top-[53px] w-[19.302px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] tracking-[1px] uppercase whitespace-nowrap">MM</p>
    </div>
  );
}

function Container47() {
  return (
    <div className="absolute h-[28px] left-[60.17px] opacity-40 top-[20px] w-[5.365px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[28px] left-0 text-[#ffcb3c] text-[18px] top-0 whitespace-nowrap">:</p>
    </div>
  );
}

function Container44() {
  return (
    <div className="h-[68px] relative shrink-0 w-[65.531px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container45 />
        <Container46 />
        <Container47 />
      </div>
    </div>
  );
}

function Container49() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.06)] h-[49px] left-0 rounded-[10px] top-0 w-[52.167px]" data-name="Container">
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[33px] left-[26.5px] text-[#ffcb3c] text-[22px] text-center top-[8px] tracking-[0.44px] whitespace-nowrap">49</p>
    </div>
  );
}

function Container50() {
  return (
    <div className="absolute h-[15px] left-[18.95px] top-[53px] w-[14.26px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] tracking-[1px] uppercase whitespace-nowrap">SS</p>
    </div>
  );
}

function Container48() {
  return (
    <div className="h-[68px] relative shrink-0 w-[52.167px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container49 />
        <Container50 />
      </div>
    </div>
  );
}

function Countdown() {
  return (
    <div className="content-stretch flex gap-[8px] h-[68px] items-end relative shrink-0 w-full" data-name="Countdown">
      <Container34 />
      <Container39 />
      <Container44 />
      <Container48 />
    </div>
  );
}

function Container32() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.03)] content-stretch flex flex-col gap-[12px] h-[129.333px] items-start left-[24.67px] pb-[0.667px] pt-[16.667px] px-[16.667px] rounded-[14px] top-[271.67px] w-[642.667px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <Container33 />
      <Countdown />
    </div>
  );
}

function Container52() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px]">Threshold</p>
    </div>
  );
}

function Container53() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[20px] left-0 text-[#f5f5f7] text-[14px] top-[-0.33px] whitespace-nowrap">200 backers</p>
    </div>
  );
}

function Container51() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.04)] content-stretch flex flex-col gap-[4px] h-[65.333px] items-start left-[24.67px] pb-[0.667px] pt-[12.667px] px-[12.667px] rounded-[10px] top-[417px] w-[206.219px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[10px]" />
      <Container52 />
      <Container53 />
    </div>
  );
}

function Container55() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px]">Pledged</p>
    </div>
  );
}

function Container56() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[20px] left-0 text-[#f5f5f7] text-[14px] top-[-0.33px] whitespace-nowrap">156</p>
    </div>
  );
}

function Container54() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.04)] content-stretch flex flex-col gap-[4px] h-[65.333px] items-start left-[242.89px] pb-[0.667px] pt-[12.667px] px-[12.667px] rounded-[10px] top-[417px] w-[206.219px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[10px]" />
      <Container55 />
      <Container56 />
    </div>
  );
}

function Container58() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px]">Spots left</p>
    </div>
  );
}

function Container59() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[20px] left-0 text-[#f5f5f7] text-[14px] top-[-0.33px] whitespace-nowrap">244</p>
    </div>
  );
}

function Container57() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.04)] content-stretch flex flex-col gap-[4px] h-[65.333px] items-start left-[461.1px] pb-[0.667px] pt-[12.667px] px-[12.667px] rounded-[10px] top-[417px] w-[206.229px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[10px]" />
      <Container58 />
      <Container59 />
    </div>
  );
}

function Container16() {
  return (
    <div className="bg-[#14141b] h-[507px] relative rounded-[16px] shrink-0 w-full" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <Container17 />
      <Heading2 />
      <Text1 />
      <Container24 />
      <Container29 />
      <Container31 />
      <Container32 />
      <Container51 />
      <Container54 />
      <Container57 />
    </div>
  );
}

function Text6() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start left-[542.84px] top-[7.33px] w-[107.823px]" data-name="Text">
      <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">Buy early, pay less</p>
    </div>
  );
}

function Container60() {
  return (
    <div className="absolute h-[27px] left-[20.67px] top-[20.67px] w-[650.667px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-0 not-italic text-[#f5f5f7] text-[18px] top-0 whitespace-nowrap">Bonding curve</p>
      <Text6 />
    </div>
  );
}

function Container63() {
  return (
    <div className="absolute h-[15px] left-[69.91px] top-0 w-[16.354px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] whitespace-nowrap">$12</p>
    </div>
  );
}

function Container65() {
  return <div className="bg-gradient-to-b from-[rgba(41,224,122,0.8)] h-[26.667px] relative rounded-tl-[6px] rounded-tr-[6px] shrink-0 to-[rgba(41,224,122,0.4)] w-full" data-name="Container" />;
}

function Container64() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.05)] h-[28px] left-0 rounded-tl-[8px] rounded-tr-[8px] top-[19px] w-[156.167px]" data-name="Container">
      <div className="content-stretch flex flex-col items-start overflow-clip p-[0.667px] relative rounded-[inherit] size-full">
        <Container65 />
      </div>
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(0,0,0,0)] border-solid inset-0 pointer-events-none rounded-tl-[8px] rounded-tr-[8px]" />
    </div>
  );
}

function Container66() {
  return (
    <div className="absolute h-[13.5px] left-[65.25px] top-[51px] w-[25.667px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[13.5px] left-0 text-[#8a8a99] text-[9px] top-[-0.33px] tracking-[0.225px] uppercase whitespace-nowrap">Tier 1</p>
    </div>
  );
}

function Container62() {
  return (
    <div className="flex-[156.167_0_0] h-[64.5px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container63 />
        <Container64 />
        <Container66 />
      </div>
    </div>
  );
}

function Container68() {
  return (
    <div className="absolute h-[15px] left-[69.79px] top-0 w-[16.583px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[15px] left-0 text-[#ffcb3c] text-[10px] top-[-0.33px] whitespace-nowrap">$18</p>
    </div>
  );
}

function Container70() {
  return <div className="absolute bg-gradient-to-b from-[#ffcb3c] h-[35.729px] left-0 rounded-tl-[6px] rounded-tr-[6px] shadow-[0px_0px_12px_0px_rgba(255,203,60,0.33)] to-[rgba(255,203,60,0.53)] top-[8.94px] w-[154.833px]" data-name="Container" />;
}

function Container71() {
  return <div className="absolute bg-gradient-to-b from-[#ffcb3c] h-[35.729px] left-0 shadow-[0px_0px_14px_0px_rgba(255,203,60,0.4)] to-[rgba(255,203,60,0.6)] top-[8.94px] w-[154.833px]" data-name="Container" />;
}

function Container69() {
  return (
    <div className="absolute bg-[rgba(255,255,255,0.05)] border-[0.667px] border-[rgba(255,203,60,0.25)] border-solid h-[46px] left-0 overflow-clip rounded-tl-[8px] rounded-tr-[8px] top-[19px] w-[156.167px]" data-name="Container">
      <Container70 />
      <Container71 />
    </div>
  );
}

function Container72() {
  return (
    <div className="absolute h-[13.5px] left-[64.42px] top-[69px] w-[27.333px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[13.5px] left-0 text-[#8a8a99] text-[9px] top-[-0.33px] tracking-[0.225px] uppercase whitespace-nowrap">Tier 2</p>
    </div>
  );
}

function Container67() {
  return (
    <div className="flex-[156.167_0_0] h-[82.5px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container68 />
        <Container69 />
        <Container72 />
      </div>
    </div>
  );
}

function Container74() {
  return (
    <div className="absolute h-[15px] left-[69px] top-0 w-[18.156px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] whitespace-nowrap">$25</p>
    </div>
  );
}

function Container75() {
  return <div className="absolute bg-[rgba(255,255,255,0.05)] border-[0.667px] border-[rgba(0,0,0,0)] border-solid h-[64px] left-0 rounded-tl-[8px] rounded-tr-[8px] top-[19px] w-[156.167px]" data-name="Container" />;
}

function Container76() {
  return (
    <div className="absolute h-[13.5px] left-[64.41px] top-[87px] w-[27.344px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[13.5px] left-0 text-[#8a8a99] text-[9px] top-[-0.33px] tracking-[0.225px] uppercase whitespace-nowrap">Tier 3</p>
    </div>
  );
}

function Container73() {
  return (
    <div className="flex-[156.167_0_0] h-[100.5px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container74 />
        <Container75 />
        <Container76 />
      </div>
    </div>
  );
}

function Container78() {
  return (
    <div className="absolute h-[15px] left-[68.98px] top-0 w-[18.208px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[15px] left-0 text-[#8a8a99] text-[10px] top-[-0.33px] whitespace-nowrap">$32</p>
    </div>
  );
}

function Container79() {
  return <div className="absolute bg-[rgba(255,255,255,0.05)] border-[0.667px] border-[rgba(0,0,0,0)] border-solid h-[82px] left-0 rounded-tl-[8px] rounded-tr-[8px] top-[19px] w-[156.167px]" data-name="Container" />;
}

function Container80() {
  return (
    <div className="absolute h-[13.5px] left-[64.31px] top-[105px] w-[27.531px]" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[13.5px] left-0 text-[#8a8a99] text-[9px] top-[-0.33px] tracking-[0.225px] uppercase whitespace-nowrap">Tier 4</p>
    </div>
  );
}

function Container77() {
  return (
    <div className="flex-[156.167_0_0] h-[118.5px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Container78 />
        <Container79 />
        <Container80 />
      </div>
    </div>
  );
}

function Container61() {
  return (
    <div className="absolute content-stretch flex gap-[6px] h-[118.5px] items-end left-[20.67px] px-[4px] top-[63.67px] w-[650.667px]" data-name="Container">
      <Container62 />
      <Container67 />
      <Container73 />
      <Container77 />
    </div>
  );
}

function Icon6() {
  return (
    <div className="absolute left-[4.5px] size-[11px] top-[4.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 11 11">
        <g id="Icon">
          <path d={svgPaths.p3fc33700} id="Vector" stroke="var(--stroke-0, #0B0B0F)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.916667" />
        </g>
      </svg>
    </div>
  );
}

function Text7() {
  return (
    <div className="bg-[#29e07a] relative rounded-[22369600px] shrink-0 size-[20px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Icon6 />
      </div>
    </div>
  );
}

function Container83() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] left-0 text-[#f5f5f7] text-[14px] top-[-0.33px] whitespace-nowrap">Super Early</p>
    </div>
  );
}

function Container84() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px]">50/50 sold</p>
    </div>
  );
}

function Container82() {
  return (
    <div className="flex-[1_0_0] h-[36px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative size-full">
        <Container83 />
        <Container84 />
      </div>
    </div>
  );
}

function Container81() {
  return (
    <div className="h-[36px] relative shrink-0 w-[106.771px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[10px] items-center relative size-full">
        <Text7 />
        <Container82 />
      </div>
    </div>
  );
}

function Text8() {
  return (
    <div className="h-[22.854px] relative shrink-0 w-[26.438px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[22.857px] left-0 text-[#f5f5f7] text-[16px] top-[-0.33px] whitespace-nowrap">$12</p>
      </div>
    </div>
  );
}

function ListItem() {
  return (
    <div className="h-[57.333px] relative rounded-[14px] shrink-0 w-full" data-name="List Item">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(0,0,0,0)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between px-[12.667px] py-[10.667px] relative size-full">
          <Container81 />
          <Text8 />
        </div>
      </div>
    </div>
  );
}

function Text9() {
  return (
    <div className="bg-[#ffcb3c] relative rounded-[22369600px] shrink-0 size-[20px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[20px] left-[7.48px] text-[#0b0b0f] text-[14px] top-[-0.33px] whitespace-nowrap">•</p>
      </div>
    </div>
  );
}

function Container87() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] left-0 text-[#f5f5f7] text-[14px] top-[-0.33px] whitespace-nowrap">Early</p>
    </div>
  );
}

function Container88() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">80/100 sold</p>
    </div>
  );
}

function Container86() {
  return (
    <div className="h-[36px] relative shrink-0 w-[67.531px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative size-full">
        <Container87 />
        <Container88 />
      </div>
    </div>
  );
}

function Text10() {
  return (
    <div className="bg-[#ffcb3c] h-[16.854px] relative rounded-[22369600px] shrink-0 w-[35.604px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[12.857px] left-[8px] text-[#0b0b0f] text-[9px] top-[1.67px] tracking-[0.45px] whitespace-nowrap">LIVE</p>
      </div>
    </div>
  );
}

function Container85() {
  return (
    <div className="h-[36px] relative shrink-0 w-[143.135px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[10px] items-center relative size-full">
        <Text9 />
        <Container86 />
        <Text10 />
      </div>
    </div>
  );
}

function Text11() {
  return (
    <div className="h-[22.854px] relative shrink-0 w-[26.531px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[22.857px] left-0 text-[#f5f5f7] text-[16px] top-[-0.33px] whitespace-nowrap">$18</p>
      </div>
    </div>
  );
}

function ListItem1() {
  return (
    <div className="bg-[rgba(255,203,60,0.06)] h-[57.333px] relative rounded-[14px] shrink-0 w-full" data-name="List Item">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,203,60,0.21)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between px-[12.667px] py-[10.667px] relative size-full">
          <Container85 />
          <Text11 />
        </div>
      </div>
    </div>
  );
}

function Icon7() {
  return (
    <div className="absolute left-[5.5px] size-[9px] top-[5.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 9 9">
        <g clipPath="url(#clip0_111_2794)" id="Icon">
          <path d={svgPaths.pe5c1500} id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.75" />
          <path d={svgPaths.p3e72fc00} id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.75" />
        </g>
        <defs>
          <clipPath id="clip0_111_2794">
            <rect fill="white" height="9" width="9" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Text12() {
  return (
    <div className="bg-[rgba(255,255,255,0.06)] relative rounded-[22369600px] shrink-0 size-[20px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Icon7 />
      </div>
    </div>
  );
}

function Container91() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] left-0 text-[#8a8a99] text-[14px] top-[-0.33px] whitespace-nowrap">Standard</p>
    </div>
  );
}

function Container92() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] relative shrink-0 text-[#8a8a99] text-[12px] whitespace-nowrap">26/150 sold</p>
    </div>
  );
}

function Container90() {
  return (
    <div className="flex-[1_0_0] h-[36px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative size-full">
        <Container91 />
        <Container92 />
      </div>
    </div>
  );
}

function Container89() {
  return (
    <div className="h-[36px] relative shrink-0 w-[96.438px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[10px] items-center relative size-full">
        <Text12 />
        <Container90 />
      </div>
    </div>
  );
}

function Text13() {
  return (
    <div className="h-[22.854px] relative shrink-0 w-[28.802px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[22.857px] left-0 text-[#5a5a66] text-[16px] top-[-0.33px] whitespace-nowrap">$25</p>
      </div>
    </div>
  );
}

function ListItem2() {
  return (
    <div className="h-[57.333px] relative rounded-[14px] shrink-0 w-full" data-name="List Item">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(0,0,0,0)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between px-[12.667px] py-[10.667px] relative size-full">
          <Container89 />
          <Text13 />
        </div>
      </div>
    </div>
  );
}

function Icon8() {
  return (
    <div className="absolute left-[5.5px] size-[9px] top-[5.5px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 9 9">
        <g clipPath="url(#clip0_111_2794)" id="Icon">
          <path d={svgPaths.pe5c1500} id="Vector" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.75" />
          <path d={svgPaths.p3e72fc00} id="Vector_2" stroke="var(--stroke-0, #8A8A99)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="0.75" />
        </g>
        <defs>
          <clipPath id="clip0_111_2794">
            <rect fill="white" height="9" width="9" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Text14() {
  return (
    <div className="bg-[rgba(255,255,255,0.06)] relative rounded-[22369600px] shrink-0 size-[20px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Icon8 />
      </div>
    </div>
  );
}

function Container95() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Medium',sans-serif] font-medium leading-[20px] left-0 text-[#8a8a99] text-[14px] top-[-0.33px] whitespace-nowrap">Greenlit Door</p>
    </div>
  );
}

function Container96() {
  return (
    <div className="content-stretch flex h-[16px] items-start relative shrink-0 w-full" data-name="Container">
      <p className="[word-break:break-word] flex-[1_0_0] font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] min-w-px relative text-[#8a8a99] text-[12px]">0/100 sold</p>
    </div>
  );
}

function Container94() {
  return (
    <div className="flex-[1_0_0] h-[36px] min-w-px relative" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start relative size-full">
        <Container95 />
        <Container96 />
      </div>
    </div>
  );
}

function Container93() {
  return (
    <div className="h-[36px] relative shrink-0 w-[118.49px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex gap-[10px] items-center relative size-full">
        <Text14 />
        <Container94 />
      </div>
    </div>
  );
}

function Text15() {
  return (
    <div className="h-[22.854px] relative shrink-0 w-[28.938px]" data-name="Text">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[22.857px] left-0 text-[#5a5a66] text-[16px] top-[-0.33px] whitespace-nowrap">$32</p>
      </div>
    </div>
  );
}

function ListItem3() {
  return (
    <div className="h-[57.333px] relative rounded-[14px] shrink-0 w-full" data-name="List Item">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(0,0,0,0)] border-solid inset-0 pointer-events-none rounded-[14px]" />
      <div className="flex flex-row items-center size-full">
        <div className="content-stretch flex items-center justify-between px-[12.667px] py-[10.667px] relative size-full">
          <Container93 />
          <Text15 />
        </div>
      </div>
    </div>
  );
}

function List() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[8px] h-[253.333px] items-start left-[20.67px] top-[202.17px] w-[650.667px]" data-name="List">
      <ListItem />
      <ListItem1 />
      <ListItem2 />
      <ListItem3 />
    </div>
  );
}

function PricingTier() {
  return (
    <div className="bg-[#14141b] h-[476.167px] relative rounded-[16px] shrink-0 w-full" data-name="PricingTier">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <Container60 />
      <Container61 />
      <List />
    </div>
  );
}

function Heading3() {
  return (
    <div className="h-[27px] relative shrink-0 w-full" data-name="Heading 3">
      <p className="[word-break:break-word] absolute font-['Inter:Medium',sans-serif] font-medium leading-[27px] left-0 not-italic text-[#f5f5f7] text-[18px] top-0 whitespace-nowrap">How it works</p>
    </div>
  );
}

function ListItem4() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="List Item">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[0] left-0 text-[#8a8a99] text-[0px] top-[-0.33px] whitespace-nowrap">
        <span className="leading-[20px] text-[14px]">Buy early</span>
        <span className="font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[20px] text-[14px]">{` — earlier tiers are cheaper.`}</span>
      </p>
    </div>
  );
}

function ListItem5() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="List Item">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[0] left-0 text-[#8a8a99] text-[0px] top-[-0.33px] whitespace-nowrap">
        <span className="leading-[20px] text-[14px]">Hit the threshold</span>
        <span className="font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[20px] text-[14px]">{` — the event is greenlit and the party is on.`}</span>
      </p>
    </div>
  );
}

function ListItem6() {
  return (
    <div className="h-[20px] relative shrink-0 w-full" data-name="List Item">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[0] left-0 text-[#8a8a99] text-[0px] top-[-0.33px] whitespace-nowrap">
        <span className="leading-[20px] text-[14px]">Missed the threshold?</span>
        <span className="font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[20px] text-[14px]">{` You're automatically refunded in full.`}</span>
      </p>
    </div>
  );
}

function NumberedList() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] h-[84px] items-start relative shrink-0 w-full" data-name="Numbered List">
      <ListItem4 />
      <ListItem5 />
      <ListItem6 />
    </div>
  );
}

function Container97() {
  return (
    <div className="bg-[#14141b] h-[172.333px] relative rounded-[16px] shrink-0 w-full" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <div className="content-stretch flex flex-col gap-[12px] items-start pb-[0.667px] pt-[24.667px] px-[24.667px] relative size-full">
        <Heading3 />
        <NumberedList />
      </div>
    </div>
  );
}

function Container1() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[32px] h-[1450.833px] items-start left-[226.67px] top-[549px] w-[692px]" data-name="Container">
      <Container2 />
      <Container15 />
      <Container16 />
      <PricingTier />
      <Container97 />
    </div>
  );
}

function Container99() {
  return <div className="absolute bg-[rgba(255,255,255,0.08)] h-px left-[24px] top-[138px] w-[330.667px]" data-name="Container" />;
}

function Button1() {
  return (
    <div className="absolute bg-[#ff0a0a] h-[52px] left-[24px] rounded-[12px] top-[159px] w-[330.667px]" data-name="Button">
      <p className="-translate-x-1/2 [word-break:break-word] absolute font-['Space_Grotesk:Bold',sans-serif] font-bold leading-[22.857px] left-[165.67px] text-[16px] text-center text-white top-[14px] w-[150px]">Cancel Event</p>
    </div>
  );
}

function Icon9() {
  return (
    <div className="absolute left-0 size-[14px] top-[2px]" data-name="Icon">
      <svg className="absolute block inset-0 size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 14 14">
        <g id="Icon">
          <path d={svgPaths.pd04fc00} id="Vector" stroke="var(--stroke-0, #A6F3C8)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.16667" />
        </g>
      </svg>
    </div>
  );
}

function Text16() {
  return (
    <div className="absolute h-[48px] left-[22px] top-0 w-[283.333px]" data-name="Text">
      <p className="[word-break:break-word] absolute font-['Space_Grotesk:Regular',sans-serif] font-normal leading-[16px] left-0 text-[#a6f3c8] text-[12px] top-0 w-[284px]">Please note that if an event is cancelled, a full refund will be issued. Refunds will be credited back to your account within 5 working days.</p>
    </div>
  );
}

function Container101() {
  return (
    <div className="h-[48px] relative shrink-0 w-full" data-name="Container">
      <Icon9 />
      <Text16 />
    </div>
  );
}

function Container100() {
  return (
    <div className="absolute bg-[rgba(41,224,122,0.08)] content-stretch flex flex-col h-[73.333px] items-start left-[24px] pb-[0.667px] pt-[12.667px] px-[12.667px] rounded-[10px] top-[231px] w-[330.667px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[0.667px] border-[rgba(41,224,122,0.25)] border-solid inset-0 pointer-events-none rounded-[10px]" />
      <Container101 />
    </div>
  );
}

function Container98() {
  return (
    <div className="absolute bg-[#14141b] border-[0.667px] border-[rgba(255,255,255,0.08)] border-solid h-[329.667px] left-[950.67px] rounded-[16px] top-[549px] w-[380px]" data-name="Container">
      <Container99 />
      <Button1 />
      <Container100 />
    </div>
  );
}

function App() {
  return (
    <div className="bg-[#0b0b0f] h-[2031.833px] relative shrink-0 w-full" data-name="App">
      <Button />
      <Container />
      <Container1 />
      <Container98 />
    </div>
  );
}

export default function Body() {
  return (
    <div className="content-stretch flex flex-col items-start relative size-full" data-name="Body">
      <App />
    </div>
  );
}